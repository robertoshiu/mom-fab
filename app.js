// app.js — MOM FAB SimulationController bootstrap (T9).
// Assembles the engine: SimulationState + Dispatcher + TickScheduler, generates
// the deterministic factory data + 180-tick skeleton, and drives the 1s tick
// loop. Exposes the 8-key window.__SIM QA contract (3A). Initial locale zh-TW,
// initial theme dark. No bundler — native ESM via the import map in index.html.

import { TickScheduler } from './engine/tick-scheduler.js';
import { Dispatcher } from './engine/dispatcher.js';
import { SimulationState } from './engine/state.js';
import { pregenerate } from './engine/factory.js';
import { generateSkeleton } from './engine/skeleton.js';
import { eventRouting } from './scenarios/mom-fab.js';
import { gateEvent } from './engine/event-gate.js';
import i18n, { setLocale, applyDom, t, onLocaleChange } from './i18n/index.js';
import { initNav } from './shell/nav.js';
import { KpiStrip } from './shell/kpi-strip.js';
import { createEventRiver } from './shell/event-river.js';
import { createRouter } from './shell/router.js';

const KNOWN_EVENT_TYPES = new Set(Object.keys(eventRouting));

function boot() {
  // --- initial locale + theme (3A) ----------------------------------------
  // theme: dark is the default (data-theme="dark" set in index.html); the
  // toggle is the single source of truth (T8) — we do not override at runtime.
  document.documentElement.setAttribute('data-theme', 'dark');
  // locale: zh-TW. setLocale re-scans [data-i18n] so the shell renders copy
  // (boot label, empty-state placeholder, reload button) on first paint.
  setLocale('zh-TW');
  applyDom();

  // --- left module navigation (T10) ---------------------------------------
  // Builds the 9-button rail + theme/locale/demo controls; the router (T13)
  // listens for the module:change CustomEvent it dispatches.
  initNav();

  // --- engine assembly ------------------------------------------------------
  const state = new SimulationState();
  // T29 (C2): the dispatcher gate binds the shared state so a user's MES action
  // (Hold/Scrap/Complete) suppresses the skeleton's subsequent lifecycle events
  // for that lot. Non-suppressible events (alarms, SPC/APC jitter, yield.alert,
  // recipe.changed, …) carry no `suppressible` flag and pass through untouched.
  // State is bound by closure (declared above), so it is live at emit time.
  const dispatcher = new Dispatcher((event) => gateEvent(event, state));

  // Deterministic domain data + lifecycle skeleton.
  const { lots, equipment, recipes } = pregenerate();
  state.load({ lots, equipment, recipes });
  const skeleton = generateSkeleton(lots, equipment, recipes);

  // --- top KPI strip (T11) -------------------------------------------------
  // Six KPI cards read state.kpis / state.alarms each tick; count-up is render
  // only (10A). Built after state.load so the first paint has real values.
  state.recomputeKpis();
  const kpiStrip = new KpiStrip(document.getElementById('kpi-strip'), { state });
  kpiStrip.init();

  // --- top event river (T12) ----------------------------------------------
  // Subscribes to ALL dispatcher events; chips drift left, priority types pin
  // leftmost. Mounted before the scheduler starts so it captures tick-0 events.
  // The instance lives via its dispatcher subscription (constructor side effect)
  // — it is intentionally NOT exposed on window.__SIM (the QA contract is the
  // exact 8-key surface below; an extra key fails the T9 mandatory check).
  // eslint-disable-next-line no-unused-vars
  const eventRiver = createEventRiver({
    container: document.getElementById('event-river'),
    dispatcher,
  });

  // --- lot lifecycle → state.lots status (T11/T9) --------------------------
  // The skeleton emits MES lifecycle events through the dispatcher; this is the
  // subscriber that folds them back into authoritative lot.status so the
  // per-tick state.recomputeKpis() sees lots transition queued→running→complete.
  // Without this, every lot keeps an undefined status (counted as WIP forever)
  // and the KPI strip is frozen at {wip:100, throughput:0, yield:100, ...}.
  // T24 cross-cutting fix: a user override (MES Hold/Scrap/Complete) is
  // authoritative and must survive subsequent skeleton lifecycle events for the
  // same lot — otherwise a Hold is silently clobbered back to running by the
  // next step.transition, and WIP/KPIs lose it. Guard each status write behind
  // the override map (hold lasts until its `until` tick; scrap/complete are
  // terminal). The producing modules read the override directly for the view.
  const setStatusUnlessOverridden = (lotId, status, tick) => {
    const o = state.suppressOverrides.get(lotId);
    if (o) {
      // terminal overrides always win; a hold wins until its expiry tick.
      if (o.status !== 'hold') return;
      if (tick == null || tick < o.until) return;
      // hold expired → fall through and let the lifecycle event resume status.
    }
    state.updateLot(lotId, { status });
  };
  dispatcher.subscribeAll('lot-lifecycle', {
    'lot.start': (p) => setStatusUnlessOverridden(p.lotId, 'running', scheduler.currentTick),
    'step.transition': (p) => setStatusUnlessOverridden(p.lotId, 'running', scheduler.currentTick),
    'material.in_transit': (p) => setStatusUnlessOverridden(p.lotId, 'in_process', scheduler.currentTick),
    'lot.complete': (p) => setStatusUnlessOverridden(p.lotId, 'complete', scheduler.currentTick),
  });

  // T24 I2 chain persistence: a recipe.changed (Recipe sign-off) is emitted while
  // the Recipe module is mounted — APC / MES are usually NOT mounted then, so a
  // per-mount subscription misses it. Persist the latest signed recipe + a
  // monotonic counter onto the shared state so APC (baseline shift) and MES
  // (current-step recipe) re-derive it the next time they mount/update, keeping
  // the cross-module chain live regardless of which module is on screen.
  state.recipeChanges = 0;
  state.lastRecipeChange = null;
  dispatcher.subscribeAll('recipe-bridge', {
    'recipe.changed': (p) => {
      state.recipeChanges = (state.recipeChanges || 0) + 1;
      state.lastRecipeChange = {
        recipeId: p && p.recipeId,
        product: p && p.product,
        version: p && p.version,
        signer: p && p.signer,
        tick: scheduler.currentTick,
      };
    },
  });

  // --- main-content SPA router (T13) ---------------------------------------
  // Owns the 9 lazy modules' lifecycle in #content, replacing the static
  // empty-state placeholder. ctx = { state, dispatcher, t, router }. Modules
  // arrive in Wave 3; until then set('mes') fails soft into a warm inline panel
  // (NOT the D14 boot banner). createRouter pre-registers all nine + wires the
  // nav module:change + river:navigate intents.
  const router = createRouter({
    container: document.getElementById('content'),
    state,
    dispatcher,
    t,
  });
  // T24 integration fix: the event river lives in the topbar, NOT inside the
  // router's #content container, so its bubbling `river:navigate` CustomEvent
  // never reaches the router's container listener. Bridge the two explicitly via
  // the river's onNavigate callback → router.set(module, focus). The focus
  // payload (built from EVENT_ROUTING + the chip's event payload) lets the target
  // module highlight the related entity (e.g. lot.start chip → MES lot row).
  eventRiver.onNavigate = (module, detail) => {
    router.navigateFromEvent(detail);
  };
  // 6A: locale change re-runs the active module's full reconcile so SVG/canvas
  // text re-pulls t(key) (the [data-i18n] DOM scan can't reach inside charts).
  onLocaleChange(() => router.refreshActive());

  // --- TickScheduler with epoch-reset hooks wired in T4's order contract ---
  // The scheduler OWNS the order (snapshot → clear → reset → choreo → resume);
  // we only supply the callbacks. Choreography is a null-op until T26/T30.
  // M3 (T26) — the 1.2s choreographed epoch transition. The scheduler owns the
  // 4A order (freeze → snapshot → clear → reset → CHOREO → resume) and calls
  // onChoreography(1200) synchronously after currentTick rewinds to 0; emits stay
  // frozen for the whole window. We sequence the five visible beats here:
  //   (a) 0.0–0.3s  KPI numbers count DOWN to 0      (kpiStrip.choreoCountdown)
  //   (b) 0.0–0.3s  river chips slide OUT left       (eventRiver.epochSlideOut)
  //   (c) 0.3–0.6s  content crossfade out → in       (#content .epoch-crossfade)
  //   (d) 0.6–1.1s  KPI numbers count back UP        (kpiStrip.choreoCountup)
  //   (e) 0.6s      river refills (cleared → re-enter on tick-0 emits)
  // Reduced-motion: the hooks each early-return to an instant swap, so the whole
  // transition collapses to a single frame (no slide, no dim, no fade).
  const contentEl = document.getElementById('content');
  let _choreoTimers = [];
  function clearChoreoTimers() {
    for (const id of _choreoTimers) clearTimeout(id);
    _choreoTimers = [];
  }
  function runEpochChoreography(windowMs) {
    clearChoreoTimers();
    const reduce = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // (a) + (b): wind the KPIs down to 0 and slide the river out (both 0.3s).
    kpiStrip.choreoCountdown(300);
    eventRiver.epochSlideOut();

    if (reduce) {
      // instant swap: refill + restore numbers immediately, no timeline.
      eventRiver.epochRefill();
      kpiStrip.choreoCountup(500);
      return;
    }

    // (c) content crossfade out at 0.3s, back in at 0.6s.
    _choreoTimers.push(setTimeout(() => {
      if (contentEl) contentEl.classList.add('epoch-crossfade');
    }, 300));
    _choreoTimers.push(setTimeout(() => {
      if (contentEl) contentEl.classList.remove('epoch-crossfade');
    }, 600));

    // (e) river refills + (d) KPIs count back up, starting at 0.6s so the
    // refill lands as content returns; count-up (0.5s) finishes by ~1.1s, well
    // inside the 1.2s window before emits resume.
    _choreoTimers.push(setTimeout(() => {
      eventRiver.epochRefill();
      kpiStrip.choreoCountup(500);
    }, 600));
  }

  const scheduler = new TickScheduler({
    onFreeze: () => {},
    onSnapshot: () => state.snapshotForEpochReset(),
    onClearOverrides: () => state.suppressOverrides.clear(),
    onChoreography: (windowMs) => runEpochChoreography(windowMs), // M3 1.2s transition (T26)
    onResume: () => {},
  });

  // --- the per-tick drive ---------------------------------------------------
  function emitSkeletonTick(tick) {
    const slot = skeleton[tick];
    if (!slot) return;
    for (const ev of slot.events) {
      if (KNOWN_EVENT_TYPES.has(ev.type)) {
        // T29: forward the skeleton event's gate meta (suppressible/lotId/tick)
        // so the dispatcher gateFn can suppress events for a Hold/Scrap/Complete
        // lot. ev.tick is the skeleton's scheduled tick (== the current tick),
        // which the gate compares against a hold override's expiry.
        dispatcher.emit(ev.type, ev.payload, {
          suppressible: ev.suppressible === true,
          lotId: ev.lotId,
          tick: ev.tick,
        });
      }
    }
  }

  function onTick(tick) {
    emitSkeletonTick(tick);   // skeleton events → dispatcher.emit
    state.recomputeKpis();    // derive KPIs once per tick (state-first)
    kpiStrip.update(tick);    // T11: full reconcile after state mutation (2B)
    router.tick(tick);        // T13: drive the active module's per-tick update (2B)
  }

  scheduler.start(onTick, () => {});

  // Default module on boot: mes. The nav rail already dispatched module:change
  // for 'mes' during initNav() (before the router existed to hear it), so we
  // set it explicitly here. Until T15 lands this shows the warm soft-fail panel
  // — acceptable this wave (it must NOT trip the D14 boot banner).
  router.set('mes');

  // --- window.__SIM 8-key contract (3A) ------------------------------------
  // router / d3 / playHeroStory / stopHeroStory are null-stub placeholders;
  // later tasks register themselves onto __SIM. setEpochLength delegates to the
  // scheduler so QA can shorten epochs deterministically.
  window.__SIM = {
    scheduler,
    router,                // T13: SPA router (module lifecycle owner)
    state,
    dispatcher,
    d3: null,              // TODO(T28): d3-loader registers the D3 barrel here
    playHeroStory: null,   // TODO(T30): hero story choreography registers here
    stopHeroStory: null,   // TODO(T30): hero story stop registers here
    setEpochLength: (n) => scheduler.setEpochLength(n),
  };

  // re-apply the reload button label now that i18n is active.
  const reloadBtn = document.getElementById('boot-error-reload');
  if (reloadBtn) reloadBtn.textContent = t('common.reload');

  // boot succeeded — clear the timeout + hide the spinner (D14).
  if (typeof window.__bootComplete === 'function') window.__bootComplete();
}

// Surface any boot-time throw through the D14 banner instead of a dead spinner.
try {
  boot();
} catch (err) {
  if (typeof window.__bootError === 'function') {
    window.__bootError((err && err.message) || String(err));
  } else {
    throw err;
  }
}
