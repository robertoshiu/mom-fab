// engine/tour-engine.js — declarative guided-tour step sequencer (M1).
//
// A small, explicit (<400 line) engine that walks a tour's step list, switches
// modules through the router, resolves a [data-tour] anchor per step, and drives
// components/spotlight.js to mask + explain it. Pure orchestration: ALL visual
// chrome lives in spotlight.js; ALL copy comes from i18n t(key). No build step,
// native ESM, factory-function export to match the codebase style.
//
// Step schema (CONTRACT with scenarios/tours.js):
//   { id, module|null, anchor|null, fallbackAnchor?, placement?, pad?, focus?,
//     desktopOnly?, final? }
//   module null  → shell-level step (no router.set; anchor lives in the shell)
//   anchor null  → centered card (no cutout); `final:true` → terminal summary
//
// i18n keys (CONTRACT): tour.<tourId>.title, tour.<tourId>.<stepId>.title/.body,
//   tour.ui.* (next/prev/skip/done/resume/stepOf/nextStation/explore/openHub/
//   continueGrand/desktopOnlyNote).
//
// Modes: 'manual' (default — click scrim or Next advances) and 'auto' (7 ticks
// per step; hover/focus on the callout freezes; tab hidden pauses). Interrupts:
// genuine nav (module:change) → stop('nav') + persist lastStep; Esc → stop, but
// SUSPENDED while a .dialog-backdrop exists (F4 — dialog.js owns Esc then).

import { tours, tourIds } from '../scenarios/tours.js';
import { createSpotlight } from '../components/spotlight.js';

const STORAGE_KEY = 'momfab.tour.v1';
const TICKS_PER_STEP = 7;      // DS-8: 7 ticks (≈7s) per auto step
const ANCHOR_POLL_MS = 2000;   // F7: poll for the anchor up to 2s after mount
// Deep-link first step: the carrier module mounts async during boot (lazy import
// → d3 loader → chart-kit), which can exceed the normal 2s window. The first step
// of a ?tour= start gets a longer grace period so its anchor resolves before we
// fall back to a degraded centered card.
const DEEPLINK_FIRST_POLL_MS = 6000;
const MOBILE_BP = 768;         // <768 = monitoring posture (bottom-sheet)

const VALID_TOUR_IDS = new Set(Array.isArray(tourIds) ? tourIds : []);
const TOUR_BY_ID = new Map((Array.isArray(tours) ? tours : []).map((tr) => [tr.id, tr]));

// localStorage with a private-mode in-memory fallback (full try/catch).
function loadState() {
  const empty = { completed: {}, dismissed: false, lastStep: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      completed: (parsed && parsed.completed) || {},
      dismissed: !!(parsed && parsed.dismissed),
      lastStep: (parsed && parsed.lastStep) || null,
    };
  } catch (_) {
    return empty;
  }
}

function saveState(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (_) {
    /* private mode / quota → in-memory only; persisted = best-effort */
  }
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BP;
}

// A .dialog-backdrop in the DOM means a modal (e.g. Guide Hub) owns Esc + the
// focus trap (F4); the tour suspends its own while one is present.
function dialogOpen() {
  return typeof document !== 'undefined'
    && !!document.querySelector('.dialog-backdrop');
}

export function createTourEngine(opts = {}) {
  const {
    router,
    scheduler,
    stopHero,                 // () => stop the hero story if playing (mutex)
    t = (k) => k,
    onLocaleChange,           // (cb) => unsubscribe — re-render on locale switch
    debug = false,
  } = opts;

  const persisted = loadState();
  let unsubLocale = null;
  let unsubEpoch = null;

  const spotlight = createSpotlight({ t });

  // live run state ----------------------------------------------------------
  const run = {
    active: false,
    tourId: null,
    steps: [],
    index: 0,
    mode: 'manual',
    anchorAudit: [],          // {tourId, stepId, anchor, result} per resolution
    autoTimer: null,
    autoTicksLeft: 0,
    frozen: false,            // auto countdown frozen (hover/focus)
    raf: 0,
    pollStop: null,
    deferEnd: null,           // pending fn() waiting for epoch 'end' (A1)
    seq: 0,                   // transition token (final-wins under rapid next)
    deepLink: false,          // started via ?tour= at boot → extend first-step poll
  };

  function dbg(...args) {
    if (debug) console.debug('[tour]', ...args);
  }

  // -- persistence helpers --------------------------------------------------
  function persist() {
    saveState({
      completed: persisted.completed,
      dismissed: persisted.dismissed,
      lastStep: persisted.lastStep,
    });
  }

  // -- progress mutation (Guide Hub footer) ---------------------------------
  // resetProgress: clear completion / dismissed / lastStep both in memory AND in
  // localStorage so a re-render reflects the cleared LEDs immediately (M3).
  function resetProgress() {
    persisted.completed = {};
    persisted.dismissed = false;
    persisted.lastStep = null;
    persist();
  }

  // dismiss: persist the first-visit invite as dismissed (M3 invite "Skip").
  function dismiss() {
    persisted.dismissed = true;
    persist();
  }

  // -- public state snapshot (QA contract via __SIM) ------------------------
  function state() {
    return {
      active: run.active,
      tourId: run.tourId,
      stepIndex: run.index,
      mode: run.mode,
      anchorAudit: run.anchorAudit.slice(),
      dismissed: persisted.dismissed,
      completed: { ...persisted.completed },
      lastStep: persisted.lastStep ? { ...persisted.lastStep } : null,
    };
  }

  // E2: walk EVERY step of EVERY tour and record whether its anchor resolves
  // in the current DOM (viewport-aware: desktopOnly steps on <768 are skipped,
  // not counted red). Read by QA via __SIM.tourState().anchorAudit-style probe.
  function anchorAudit() {
    const out = [];
    const mobile = isMobile();
    for (const tr of (Array.isArray(tours) ? tours : [])) {
      for (const step of (tr.steps || [])) {
        if (step.desktopOnly && mobile) {
          out.push({ tourId: tr.id, stepId: step.id, result: 'desktop-skip' });
          continue;
        }
        if (step.final || !step.anchor) {
          out.push({ tourId: tr.id, stepId: step.id, result: 'centered' });
          continue;
        }
        const el = resolveAnchor(step);
        out.push({
          tourId: tr.id,
          stepId: step.id,
          anchor: step.anchor,
          result: el ? 'ok' : 'miss',
        });
      }
    }
    return out;
  }

  // -- anchor resolution (F8/F12: by selector EVERY time, never cached) -----
  // hidden detection: offsetParent === null → try fallbackAnchor → null
  // (caller degrades to centered card). Returns the live element or null.
  function resolveAnchor(step) {
    if (!step || !step.anchor) return null;
    const pick = (val) => {
      if (!val) return null;
      const el = document.querySelector(`[data-tour="${val}"]`);
      if (el && el.offsetParent !== null) return el;
      return null;
    };
    return pick(step.anchor) || pick(step.fallbackAnchor) || null;
  }

  // -- mode helpers ---------------------------------------------------------
  function clearAuto() {
    if (run.autoTimer) {
      clearTimeout(run.autoTimer);
      run.autoTimer = null;
    }
  }

  // Auto mode advances one step every TICKS_PER_STEP ticks. We prefer the
  // scheduler tick (so it rides the instrument heartbeat) but fall back to a 7s
  // timer when no scheduler is wired. hover/focus freezes (never resets); tab
  // hidden pauses (visibilitychange handler below).
  function armAuto() {
    clearAuto();
    if (run.mode !== 'auto') return;
    run.autoTicksLeft = TICKS_PER_STEP;
    // timer-based fallback (scheduler tick path is driven by notifyAutoTick).
    if (!scheduler) {
      const tickMs = 1000;
      const step = () => {
        if (!run.active || run.mode !== 'auto') return;
        if (run.frozen || (typeof document !== 'undefined' && document.hidden)) {
          run.autoTimer = setTimeout(step, tickMs);
          return;
        }
        run.autoTicksLeft -= 1;
        spotlight.setCountdown(run.autoTicksLeft, TICKS_PER_STEP);
        if (run.autoTicksLeft <= 0) { next(); return; }
        run.autoTimer = setTimeout(step, tickMs);
      };
      run.autoTimer = setTimeout(step, tickMs);
    }
    spotlight.setCountdown(run.autoTicksLeft, TICKS_PER_STEP);
  }

  // Scheduler-driven auto countdown — app.js can fan ticks here, but the timer
  // fallback covers the headless/no-scheduler case so this is optional.
  function notifyAutoTick() {
    if (!run.active || run.mode !== 'auto' || !scheduler) return;
    if (run.frozen || (typeof document !== 'undefined' && document.hidden)) return;
    run.autoTicksLeft -= 1;
    spotlight.setCountdown(run.autoTicksLeft, TICKS_PER_STEP);
    if (run.autoTicksLeft <= 0) next();
  }

  // -- reposition loop (S7: attached only while active) ---------------------
  function startRepositionLoop() {
    stopRepositionLoop();
    const content = document.getElementById('content');
    const onMove = () => spotlight.reposition();
    run._onMove = onMove;
    run._content = content;
    if (content) content.addEventListener('scroll', onMove, { passive: true });
    window.addEventListener('resize', onMove);
    const loop = () => {
      if (!run.active) return;
      // re-resolve the current step's anchor EVERY frame (F8/F12) and reposition.
      const step = run.steps[run.index];
      if (step && step.anchor && !step.final) {
        const el = resolveAnchor(step);
        spotlight.track(el);
      }
      run.raf = requestAnimationFrame(loop);
    };
    run.raf = requestAnimationFrame(loop);
  }

  function stopRepositionLoop() {
    if (run.raf) { cancelAnimationFrame(run.raf); run.raf = 0; }
    if (run._content && run._onMove) {
      run._content.removeEventListener('scroll', run._onMove);
    }
    if (run._onMove) window.removeEventListener('resize', run._onMove);
    run._onMove = null;
    run._content = null;
  }

  // -- the step renderer ----------------------------------------------------
  // Resolves a step into one of: centered/final card, desktopOnly substitute,
  // degraded centered card, or anchored callout. Records the result in audit.
  function renderStep() {
    const step = run.steps[run.index];
    if (!step) return;

    const total = run.steps.length;
    const ui = {
      next: t('tour.ui.next'),
      prev: t('tour.ui.prev'),
      skip: t('tour.ui.skip'),
      done: t('tour.ui.done'),
      explore: t('tour.ui.explore'),
      openHub: t('tour.ui.openHub'),
      continueGrand: t('tour.ui.continueGrand'),
      desktopOnlyNote: t('tour.ui.desktopOnlyNote'),
      // stepOf is a template like "{i}/{n}" or "{i} / {n}" — replace tokens.
      stepLabel: formatStepOf(t('tour.ui.stepOf'), run.index + 1, total),
    };
    const copy = {
      title: t(`tour.${run.tourId}.${step.id}.title`),
      body: t(`tour.${run.tourId}.${step.id}.body`),
    };

    const base = {
      step,
      index: run.index,
      total,
      mode: run.mode,
      isFirst: run.index === 0,
      isLast: run.index === total - 1,
      reducedMotion: prefersReducedMotion(),
      ui,
      copy,
      pad: typeof step.pad === 'number' ? step.pad : 8,
      placement: step.placement || 'auto',
      handlers: { onNext: next, onPrev: prev, onSkip: () => stop('skip') },
    };

    // final summary card (DS-4) — centered, no cutout; onboarding adds continue.
    if (step.final) {
      const actions = [
        { id: 'explore', label: ui.explore, onClick: () => stop('explore') },
        { id: 'openHub', label: ui.openHub, onClick: () => {
          stop('hub');
          document.dispatchEvent(new CustomEvent('guide:open'));
        } },
      ];
      // continueGrand only when a 'grand-tour' exists and this isn't it.
      if (run.tourId !== 'grand-tour' && TOUR_BY_ID.has('grand-tour')) {
        actions.push({ id: 'continueGrand', label: ui.continueGrand, onClick: () => {
          start('grand-tour', { mode: run.mode });
        } });
      }
      spotlight.showFinal({ ...base, actions });
      run.anchorAudit.push({ tourId: run.tourId, stepId: step.id, result: 'final' });
      armAuto();
      return;
    }

    // desktopOnly step on a narrow viewport → DS-13 substitute card.
    if (step.desktopOnly && isMobile()) {
      spotlight.showDesktopOnly(base);
      run.anchorAudit.push({ tourId: run.tourId, stepId: step.id, result: 'desktop-skip' });
      armAuto();
      return;
    }

    // centered (anchor null but not final) — same chrome, no cutout.
    if (!step.anchor) {
      spotlight.showCentered(base);
      run.anchorAudit.push({ tourId: run.tourId, stepId: step.id, result: 'centered' });
      armAuto();
      return;
    }

    // anchored: resolve now; if hidden/missing → DS-12 degraded centered card.
    const el = resolveAnchor(step);
    if (!el) {
      dbg('anchor miss → degrade', step.anchor);
      console.warn(`[tour] anchor "${step.anchor}" unresolved → centered card`);
      spotlight.showCentered(base);
      run.anchorAudit.push({ tourId: run.tourId, stepId: step.id, anchor: step.anchor, result: 'degrade' });
      armAuto();
      return;
    }
    spotlight.showAnchored({ ...base, anchor: el });
    run.anchorAudit.push({ tourId: run.tourId, stepId: step.id, anchor: step.anchor, result: 'ok' });
    armAuto();
  }

  // stepOf renderer — the counter MUST always read the numbers (DS-1 "3/12").
  // Tolerates three author styles for the tour.ui.stepOf string:
  //   (a) a template with tokens  → "{i}/{n}" / "{i} / {n}" / "{0}/{1}"  (substitute)
  //   (b) a bare prefix label     → "Step" / "步驟"                        (append "i/n")
  //   (c) missing key / empty     → fall back to "i/n" alone.
  function formatStepOf(tpl, i, n) {
    if (typeof tpl !== 'string' || tpl === 'tour.ui.stepOf' || tpl.trim() === '') {
      return `${i}/${n}`;
    }
    if (/\{(i|n|0|1|current|total)\}/.test(tpl)) {
      return tpl
        .replace(/\{i\}|\{0\}|\{current\}/g, String(i))
        .replace(/\{n\}|\{1\}|\{total\}/g, String(n));
    }
    // prefix label → "Step 3/12".
    return `${tpl} ${i}/${n}`;
  }

  // -- step transition (cross-module aware, F7 + A1) ------------------------
  async function goToStep(targetIndex) {
    if (!run.active) return;
    const idx = Math.max(0, Math.min(targetIndex, run.steps.length - 1));
    const step = run.steps[idx];
    if (!step) return;

    const seq = ++run.seq;        // final-wins token
    clearAuto();

    // A1: if the epoch is choreographing, defer the whole transition to 'end'.
    if (scheduler && typeof scheduler.isChoreographing === 'function'
        && scheduler.isChoreographing()) {
      dbg('epoch choreographing → defer step', step.id);
      run.deferEnd = () => { run.deferEnd = null; goToStep(targetIndex); };
      return;
    }

    run.index = idx;
    persisted.lastStep = { tourId: run.tourId, stepIndex: idx };
    persist();
    dbg('→ step', idx, step.id, 'module', step.module);

    // cross-module switch (F7): set → verify active + no .route-error → 2×rAF →
    // poll the anchor up to 2s. The spotlight shows the DS-3 "next station" card.
    const activeModule = router && typeof router.getActive === 'function'
      ? router.getActive() : null;
    const needsSwitch = step.module && step.module !== activeModule;

    if (needsSwitch && router && typeof router.set === 'function') {
      spotlight.showTransition({
        title: t('tour.ui.nextStation'),
        reducedMotion: prefersReducedMotion(),
      });
      try {
        await router.set(step.module, step.focus || null);
      } catch (err) {
        dbg('router.set threw', err && err.message);
      }
      if (seq !== run.seq) return; // superseded by a newer transition

      // F7 verification: active module matches AND no soft-fail panel in #content.
      const content = document.getElementById('content');
      const okActive = router.getActive() === step.module;
      const softFail = content && content.querySelector('.route-error');
      if (!okActive || softFail) {
        dbg('mount verify failed', { okActive, softFail: !!softFail });
        // still render — the step degrades to a centered card if the anchor is gone.
      }
      await doubleRaf();
      if (seq !== run.seq) return;
      if (step.anchor) {
        await pollAnchor(step, seq, pollWindowFor(idx));
        if (seq !== run.seq) return;
      }
    } else if (run.deepLink && idx === 0 && step.anchor && !resolveAnchor(step)) {
      // Deep-link first step that does NOT need a module switch (the carrier
      // module is already mounting from boot): the normal poll only runs on the
      // switch path, so without this the first render can degrade before the
      // async carrier (lazy import → d3 → chart-kit) finishes. Give it the same
      // extended grace period before falling back to a centered card.
      await doubleRaf();
      if (seq !== run.seq) return;
      await pollAnchor(step, seq, pollWindowFor(idx));
      if (seq !== run.seq) return;
    }

    startRepositionLoop();
    renderStep();
  }

  // The first step of a ?tour= deep-link gets the longer grace window; every
  // other step uses the standard 2s poll.
  function pollWindowFor(idx) {
    return (run.deepLink && idx === 0) ? DEEPLINK_FIRST_POLL_MS : ANCHOR_POLL_MS;
  }

  // poll [data-tour="<anchor>"] until present+visible or windowMs elapses
  // (defaults to the standard F7 2s window).
  function pollAnchor(step, seq, windowMs = ANCHOR_POLL_MS) {
    return new Promise((resolve) => {
      const start = performanceNow();
      const tick = () => {
        if (seq !== run.seq || !run.active) { resolve(); return; }
        if (resolveAnchor(step)) { resolve(); return; }
        if (performanceNow() - start >= windowMs) { resolve(); return; }
        run.pollStop = requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function doubleRaf() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function performanceNow() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  // -- navigation API -------------------------------------------------------
  function next() {
    if (!run.active) return;
    if (run.index >= run.steps.length - 1) {
      // last step (a non-final last step) → completing the tour.
      complete();
      return;
    }
    goToStep(run.index + 1);
  }

  function prev() {
    if (!run.active) return;
    if (run.index <= 0) return;
    goToStep(run.index - 1);
  }

  function complete() {
    if (!run.tourId) { stop('complete'); return; }
    persisted.completed[run.tourId] = true;
    persisted.lastStep = null;
    persist();
    stop('complete');
  }

  // -- start / stop ---------------------------------------------------------
  function start(id, { stepIndex = 0, mode = 'manual', deepLink = false } = {}) {
    if (!VALID_TOUR_IDS.has(id) || !TOUR_BY_ID.has(id)) {
      console.warn('[tour] start(): unknown or unwhitelisted tour id:', id);
      return false;
    }
    // B1: announce the start BEFORE the hero mutex fires. stopHero() can finish
    // the hero synchronously → 'hero:finished' → the first-visit invite's reveal().
    // That reveal happens while run.active is still false (it's set below), so its
    // own state().active precondition would not yet catch it. Dispatching
    // 'tour:started' here lets the invite retire up-front, and the reveal that
    // follows finds an already-retired card → no-op. Belt-and-braces with the
    // invite's reveal-time state().active re-check (which now also works because
    // we additionally set run.active before stopHero — see below).
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('tour:started', { detail: { id } }));
    }
    // A prior tour (if any) is torn down first — capture that BEFORE we flip the
    // flag, so a fresh start doesn't self-'restart'.
    const wasActive = run.active;
    // run.active goes true BEFORE the hero mutex so any synchronous reveal() the
    // mutex triggers sees an active tour at its precondition re-check (B1 fix (a)).
    run.active = true;
    // hero mutex — stop the hero story if it's mid-play.
    if (typeof stopHero === 'function') {
      try { stopHero(); } catch (_) { /* defensive */ }
    }
    if (wasActive) stop('restart');

    const tour = TOUR_BY_ID.get(id);
    run.active = true;
    run.tourId = id;
    run.steps = (tour.steps || []).slice();
    run.index = 0;
    run.mode = mode === 'auto' ? 'auto' : 'manual';
    run.anchorAudit = [];
    run.frozen = false;
    run.seq = 0;
    run.deepLink = !!deepLink;

    spotlight.open({
      mode: run.mode,
      // manual: a scrim click advances. The spotlight calls this when the scrim
      // (not the callout) is clicked. Suspended while a dialog is open (F4).
      onScrimClick: () => { if (run.mode === 'manual' && !dialogOpen()) next(); },
      // auto: hover/focus on the callout freezes the countdown (never resets).
      onFreeze: () => { run.frozen = true; },
      onUnfreeze: () => { run.frozen = false; },
      onEsc: () => { if (!dialogOpen()) stop('esc'); }, // F4: dialog owns Esc
    });

    // genuine nav (nav rail / keyboard / river chip) = exit (F14: tour is the
    // sole consumer; hero is guaranteed not playing under the mutex).
    // We listen to BOTH signals so a tour always interrupts on a user nav:
    //   • module:change — fired on a genuine module switch (router also hears it).
    //   • nav:user-intent — fired on ANY user rail click / keyboard digit, even a
    //     re-select of the already-active module. This closes B4: the rail can
    //     still read the pre-tour module while the tour's own router.set is in
    //     flight, so a user click on the visibly-active button emits no
    //     module:change — but it MUST still exit the tour. river:navigate chips
    //     route through module:change, so they are covered by that listener.
    run._onNav = () => { if (run.active) stop('nav'); };
    window.addEventListener('module:change', run._onNav);
    window.addEventListener('nav:user-intent', run._onNav);

    // visibilitychange: hidden pauses auto (the auto tick guards on document.hidden,
    // so nothing extra needed beyond ensuring the loop keeps polling — handled
    // inline in armAuto/notifyAutoTick).

    // locale change → re-render the current callout in place (S4).
    if (typeof onLocaleChange === 'function' && !unsubLocale) {
      unsubLocale = onLocaleChange(() => { if (run.active) renderStep(); });
    }
    // A1: defer a transition that lands in the epoch freeze window until 'end'.
    if (scheduler && typeof scheduler.addEpochListener === 'function' && !unsubEpoch) {
      unsubEpoch = scheduler.addEpochListener((phase) => {
        if (phase === 'end' && run.deferEnd) run.deferEnd();
      });
    }

    dbg('start', id, run.mode, 'from', stepIndex);
    goToStep(stepIndex);
    return true;
  }

  // Reasons that represent the user CLOSING the terminal (final) card. Reaching
  // the final step and dismissing it via any of these = completion (B3). 'restart'
  // is included only because continueGrand starts the next tour from the final
  // card; a plain restart never happens on a final step in practice.
  const FINAL_CLOSE_REASONS = new Set(['explore', 'hub', 'complete', 'esc', 'auto-end', 'restart']);

  function stop(reason = 'stop') {
    if (!run.active) return;
    dbg('stop', reason);

    // B3: if we're stopping on the final step via a genuine close action, record
    // completion. Interrupts BEFORE the final step (nav/esc/skip mid-tour) fall
    // through and keep only lastStep so a later resume can continue.
    const curStep = run.steps[run.index];
    const onFinal = !!(curStep && curStep.final);
    if (onFinal && run.tourId && FINAL_CLOSE_REASONS.has(reason)) {
      persisted.completed[run.tourId] = true;
      persisted.lastStep = null;
      persist();
    }

    run.active = false;
    run.seq++;                 // invalidate any in-flight transition
    clearAuto();
    stopRepositionLoop();
    if (run.pollStop) { cancelAnimationFrame(run.pollStop); run.pollStop = null; }
    if (run._onNav) {
      window.removeEventListener('module:change', run._onNav);
      window.removeEventListener('nav:user-intent', run._onNav);
      run._onNav = null;
    }
    run.deferEnd = null;
    spotlight.close();

    // 'complete'/'explore'/'hub' clear lastStep already (complete) or leave it;
    // interrupts (nav/esc/skip) keep lastStep so a later "resume" can continue.
    run.tourId = null;
    run.steps = [];
    run.index = 0;
  }

  function destroy() {
    stop('destroy');
    if (unsubLocale) { unsubLocale(); unsubLocale = null; }
    if (unsubEpoch) { unsubEpoch(); unsubEpoch = null; }
    spotlight.destroy();
  }

  return {
    start,
    stop,
    next,
    prev,
    state,
    anchorAudit,
    resetProgress,    // Guide Hub: clear completion/dismissed/lastStep
    dismiss,          // first-visit invite: persist dismissed
    notifyAutoTick,   // optional: app.js may fan scheduler ticks for auto mode
    destroy,
  };
}

export default createTourEngine;
