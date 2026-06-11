// modules/hero-story.js — TICK-DRIVEN hero scenario choreography (T30, M2).
//
// A 30-tick "wow" narrative for business demos. The timeline lives in
// scenarios/mom-fab.js (heroTimeline.steps, tick offsets 0/10/18/25/30 with
// targets mes→spc→apc→yield→overview). The story is driven ENTIRELY by the
// simulation tick — there is NO setTimeout narrative chain (F2 greps for it).
// app.js fans every scheduler tick into notifyTick(tick); each beat fires when
// currentTick reaches storyStart + step.tick.
//
// The five beats (each: router.set(module, focus) → module highlight; emit the
// bound dispatcher event so the target module's existing subscription reacts;
// push a story chip into the river; flash a 0.5s caption overlay):
//   (a) t+0   MES   — deterministic lot (heroTimeline.lotId) focus row highlight.
//   (b) t+10  SPC   — out-of-control point injected (deterministic, tick-bound)
//                     via dispatcher.emit('spc.violation', …) → SPC log + red mark.
//   (c) t+18  APC   — apc.adjustment emit → R2R adjustment animation.
//   (d) t+25  Yield — defect.detected emit (x/y bound) → pareto bump + wafer cluster.
//   (e) t+30  back to MES/overview — lot marked Recovered + trend recovery.
//
// Replay policy (heroTimeline.replayPolicy === 'once-per-load'): app.js auto-plays
// once when scheduler.currentTick === autoplayGateTick (3); the epoch loop back to
// tick 0 does NOT replay; manual replay is ONLY via the nav ▶ button (which calls
// window.__SIM.playHeroStory()).
//
// Interrupt: any genuine user module switch (nav 'module:change') during the story
// cancels it cleanly — listeners stay attached for the run's lifetime but stop()
// removes the indicator + de-emphasis class and resets state, leaving no orphan
// beats. Story-driven module switches use router.set() directly (they do NOT
// dispatch module:change), so they are distinguishable from user clicks; the nav
// rail highlight is synced via nav.setActiveSilent() (no event).
//
// Background river noise is NOT paused (the dispatcher keeps emitting per the
// spec) — non-story chips are visually de-emphasised via the #event-river.hero-dim
// class for the run's duration, restored on stop().
//
// Styling: zero raw literals — the caption overlay + topbar indicator + river-dim
// CSS is injected once as token-only rules (1px hairlines exempt). Reduced motion:
// the caption appears with no entry animation (the .hero-caption animation is
// gated off under prefers-reduced-motion).

import { heroTimeline, defectTypes } from '../scenarios/mom-fab.js';

const STYLE_ID = 'hero-story-styles';
const CAPTION_MS = 500; // 0.5s caption overlay window (spec)

// Token-only injected stylesheet. The ONLY literals are 1px hairline borders
// (iron-rule exempt) and the 0.5s caption timing expressed through CAPTION_MS.
const CSS = `
/* topbar "▶ Playing demo story…" indicator — pinned to the topbar, does not
   reflow the KPI strip (absolute within the relatively-positioned topbar). */
#topbar { position: relative; }
#topbar .hero-indicator {
  position: absolute;
  top: var(--sp-2);
  right: var(--sp-4);
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--accent-dim);
  border-radius: var(--r-card);
  background: var(--bg-inset);
  color: var(--accent);
  font: var(--fw-emphasis) var(--fs-caption) var(--font-body);
  letter-spacing: var(--label-tracking);
  text-transform: uppercase;
  white-space: nowrap;
  animation: hero-ind-pulse calc(var(--tick) * 2) ease-in-out infinite;
}
#topbar .hero-indicator .hero-ind-glyph { font-size: var(--fs-body); line-height: 1; }

/* background river de-emphasis: non-story chips dim while the story runs. The
   story's own chips re-assert full opacity via .hero-chip below. */
#event-river.hero-dim .chip { opacity: 0.35; transition: opacity var(--transition); }
#event-river.hero-dim .chip.hero-chip {
  opacity: 1;
  border-color: var(--accent);
  color: var(--accent);
}
#event-river.hero-dim .chip.hero-chip b { color: var(--accent); }

/* caption overlay — a 0.5s highlight card naming the step + one-line note. Sits
   top-centre of #content so it overlays the freshly-switched module view. */
#content .hero-caption {
  position: absolute;
  top: var(--sp-5);
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  max-width: 520px;
  padding: var(--sp-3) var(--sp-5);
  border: 1px solid var(--accent-dim);
  border-radius: var(--r-dialog);
  background: var(--bg-elevated);
  box-shadow: var(--sh-lg);
  text-align: center;
  pointer-events: none;
  animation: hero-caption-in var(--countup) var(--ease-instrument) both;
}
#content .hero-caption .hero-caption-step {
  display: block;
  color: var(--accent);
  font: var(--fw-emphasis) var(--fs-caption) var(--font-body);
  letter-spacing: var(--label-tracking);
  text-transform: uppercase;
  margin-bottom: var(--sp-1);
}
#content .hero-caption .hero-caption-note {
  font-size: var(--fs-body);
  color: var(--text-primary);
  line-height: 1.5;
}
#content .hero-caption.is-leaving {
  animation: hero-caption-out var(--transition) var(--ease-instrument) both;
}

@keyframes hero-ind-pulse {
  50% { box-shadow: 0 0 0 var(--sp-1) color-mix(in srgb, var(--accent) 18%, transparent); }
}
@keyframes hero-caption-in {
  from { opacity: 0; transform: translateX(-50%) translateY(calc(var(--sp-3) * -1)); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
@keyframes hero-caption-out {
  from { opacity: 1; transform: translateX(-50%) translateY(0); }
  to   { opacity: 0; transform: translateX(-50%) translateY(calc(var(--sp-3) * -1)); }
}

/* reduced motion: no entry/exit animation + no indicator pulse — instant swap. */
@media (prefers-reduced-motion: reduce) {
  #topbar .hero-indicator { animation: none; }
  #content .hero-caption,
  #content .hero-caption.is-leaving { animation: none; }
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

// Map a timeline step's module target to a real router module id. The final beat
// targets 'overview' (a narrative label) which routes back to MES — the lot's
// lifecycle home where its "Recovered" status reads.
function routeForStep(step) {
  return step.module === 'overview' ? 'mes' : step.module;
}

// Build the one-shot focus payload a router.set(module, focus) hands the module.
// We synthesise the SAME shape the event-river → router bridge produces (router
// _focusFromDetail) so the target modules' existing ctx.focus handlers fire
// without any module changes:
//   MES   reads focus.lotId            → selects + scrolls the lot row.
//   SPC   reads focus.type ('spc.violation'/'yield.alert') → scrolls violation log.
//   Yield reads focus.payload.type     → opens that defect type's drill-down.
function focusForStep(step, tick, lotId, defectType) {
  switch (step.module) {
    case 'mes':
    case 'overview':
      return { type: 'lot.start', lotId, payload: { lotId }, tick };
    case 'spc':
      return { type: 'spc.violation', lotId, payload: { lotId, tick }, tick };
    case 'apc':
      return { type: 'apc.adjustment', lotId, payload: { lotId }, tick };
    case 'yield':
      return {
        type: 'defect.detected',
        lotId,
        payload: { lotId, type: defectType },
        tick,
      };
    default:
      return { lotId, payload: { lotId }, tick };
  }
}

export class HeroStory {
  constructor({ scheduler, router, dispatcher, state, t, nav, onFinish } = {}) {
    this.scheduler = scheduler;
    this.router = router;
    this.dispatcher = dispatcher;
    this.state = state;
    this.t = typeof t === 'function' ? t : (k) => k;
    this.nav = nav || null; // { setActiveSilent } — optional rail-highlight sync
    // A2: fired ONCE per play run when the story ends — by natural completion
    // (_finish) OR interrupt (stop). app.js wires it to dispatch 'hero:finished'
    // so the guided-tour invite (DS-2) appears only after the hero has had its
    // moment. Guarded by _finishFired so a stop() following a _finish() (or vice
    // versa) never double-fires within the same run.
    this._onFinish = typeof onFinish === 'function' ? onFinish : null;
    this._finishFired = false;

    this._playing = false;
    this._storyStart = 0;     // currentTick when play() was called
    this._firedOffsets = new Set(); // step.tick offsets already fired this run
    this._autoplayedThisLoad = false; // once-per-load gate (survives epoch loop)

    this._caption = null;     // live caption element
    this._captionTimer = null; // the ONLY setTimeout — render-only caption removal
    this._indicator = null;   // live topbar indicator element

    this._steps = heroTimeline.steps;
    this._lotId = heroTimeline.lotId;
    this._defectType = heroTimeline.defectType;

    // genuine user nav switch during a story cancels it. Story-driven switches go
    // through router.set() directly (no module:change), so any module:change while
    // playing is a real user interrupt.
    this._onUserNav = () => {
      if (this._playing) this.stop();
    };
    window.addEventListener('module:change', this._onUserNav);
  }

  isPlaying() {
    return this._playing;
  }

  // Deep-link mutex (DS-2): when the app boots into a ?tour= deep-link the guided
  // tour owns #content from the first frame, so the hero must NOT autoplay this
  // load — otherwise its tick-3 autoplay gate would silently router.set() its own
  // module over the tour's anchored module, clobbering the spotlight target. We
  // pre-consume the once-per-load autoplay gate (same flag the gate itself sets)
  // so maybeAutoplay() no-ops for the rest of the load. The manual ▶ replay is
  // unaffected (it calls play() directly, not through the gate).
  suppressAutoplay() {
    this._autoplayedThisLoad = true;
  }

  // A2: late-bind the finish hook (matches the optional ctor `onFinish`).
  setOnFinish(fn) {
    this._onFinish = typeof fn === 'function' ? fn : null;
  }

  // Fire the finish hook at most once per play run (see _finishFired note).
  _emitFinish() {
    if (this._finishFired) return;
    this._finishFired = true;
    if (this._onFinish) {
      try {
        this._onFinish();
      } catch (err) {
        console.warn('[hero-story] onFinish hook threw:', err && err.message);
      }
    }
  }

  // Autoplay gate (once-per-load). app.js calls this every tick; we self-trigger
  // exactly once when currentTick reaches the manifest's autoplayGateTick and we
  // have not auto-played since load (the epoch loop does NOT reset this flag).
  maybeAutoplay(tick) {
    if (this._autoplayedThisLoad) return;
    if (tick !== heroTimeline.autoplayGateTick) return;
    this._autoplayedThisLoad = true;
    this.play();
  }

  // Per-tick fan-out from app.js's onTick. While playing, fire any beat whose
  // storyStart-relative offset == the current relative tick. Beats are matched by
  // exact offset so a wall-clock catch-up tick that skips ahead still fires every
  // not-yet-fired beat at or before the new relative position.
  notifyTick(tick) {
    this.maybeAutoplay(tick);
    if (!this._playing) return;
    const rel = tick - this._storyStart;
    for (const step of this._steps) {
      if (step.tick <= rel && !this._firedOffsets.has(step.tick)) {
        this._firedOffsets.add(step.tick);
        this._fireBeat(step, tick);
      }
    }
    // NOTE: we do NOT _finish() here once the last beat's offset is marked fired.
    // _fireBeat() for the closing beat resolves its work ASYNCHRONOUSLY (router.set
    // → afterMount → _completeBeat), so finishing synchronously here would clear
    // this._playing BEFORE _completeBeat() ran — the afterMount guard would then
    // bail and drop the closing-beat payload (the 'recovered' status write + the
    // closing river chip). Instead, _finish() is deferred until _completeBeat() has
    // actually executed the closing-beat work (see _completeBeat).
  }

  // Manual / autoplay entry. Idempotent guard: re-play while running restarts the
  // narrative from the current tick (manual ▶ during a run is a deliberate replay).
  play() {
    const start = this.scheduler ? this.scheduler.currentTick : 0;
    this._playing = true;
    this._finishFired = false; // A2: arm the once-per-run finish hook
    this._storyStart = start;
    this._firedOffsets = new Set();
    this._showIndicator();
    this._dimRiver(true);
    // fire the t+0 beat immediately so the story reacts on the same tick play()
    // was requested (the autoplay gate / ▶ click should feel instant).
    const first = this._steps[0];
    if (first && first.tick === 0) {
      this._firedOffsets.add(0);
      this._fireBeat(first, start);
    }
  }

  // Cancel cleanly: remove indicator + de-emphasis + caption, reset run state. No
  // orphan beats (firedOffsets cleared). Listeners stay attached for the instance
  // lifetime (a single window listener); destroy() removes them.
  stop() {
    if (!this._playing) return;
    this._playing = false;
    this._firedOffsets = new Set();
    this._hideIndicator();
    this._dimRiver(false);
    this._clearCaption(true);
    this._emitFinish(); // A2: interrupt counts as a finish for the invite gate
  }

  // Natural completion after the final beat — same teardown as stop() but it is
  // not an interrupt (kept separate for readability / future telemetry).
  _finish() {
    if (!this._playing) return;
    this._playing = false;
    this._hideIndicator();
    this._dimRiver(false);
    // leave the last caption to fade on its own timer.
    this._emitFinish(); // A2: natural completion fires the invite gate hook
  }

  destroy() {
    window.removeEventListener('module:change', this._onUserNav);
    this.stop();
  }

  // -- beats -----------------------------------------------------------------

  _fireBeat(step, tick) {
    const moduleId = routeForStep(step);
    const focus = focusForStep(step, tick, this._lotId, this._defectType);

    // (1) flash the 0.5s caption overlay immediately (step name + one-line note).
    this._showCaption(step);

    // (2) rail-highlight sync is now owned by the router's onModuleChanged callback
    //     (wired in app.js → nav.setActiveSilent), which fires after router.set()
    //     mounts the module below. Doing it here too would double-fire (harmless but
    //     redundant) and split the sync across two owners — the router is the single
    //     sync point (F3). Story switches still go through router.set() directly (no
    //     module:change), so they remain distinguishable from a user interrupt.
    //
    // (3) switch + highlight: router.set() with the synthesised focus payload so
    //     the target module's existing ctx.focus handler highlights the entity.
    //     router.set() is ASYNC (0.2s fade + lazy module load + init/subscribe);
    //     we MUST wait for it to resolve before injecting the beat's event,
    //     otherwise the emit lands before the target module has subscribed and is
    //     dropped (e.g. SPC's spc.violation log would stay empty). Awaiting the
    //     switch is RENDER ORDERING, not a narrative timer — the beat is still
    //     bound to THIS tick; we only defer the emit until its consumer exists.
    const seq = this._storyStart; // capture so a stop() mid-switch can abort
    const afterMount = () => {
      // abort if the story was cancelled (interrupt) while the switch was in flight.
      if (!this._playing || this._storyStart !== seq) return;
      this._completeBeat(step, tick);
    };
    if (this.router && typeof this.router.set === 'function') {
      const p = this.router.set(moduleId, focus);
      if (p && typeof p.then === 'function') p.then(afterMount, afterMount);
      else afterMount();
    } else {
      afterMount();
    }
  }

  // The post-switch half of a beat: emit the bound event (now that the target
  // module has mounted + subscribed), push the river chip, and (closing beat)
  // mark the lot Recovered after the chip emit so it is not clobbered to complete.
  _completeBeat(step, tick) {
    // deterministic, tick-bound event injection so the module reacts the same way
    // it would to organic data — anchored to THIS beat's tick (PRNG determinism
    // preserved: value/coords are fixed manifest constants, never Math.random).
    // Events pass the gate (no suppressible flag).
    this._injectForStep(step, tick);

    // push a story chip into the river (a real dispatcher emit; the river
    // subscribes to all types) and tag it bright while background chips dim.
    this._pushStoryChip(step, tick);

    // closing beat: mark the followed lot Recovered. MUST run AFTER the
    // lot.complete chip emit above — that emit flows through app.js's
    // lot-lifecycle subscriber and would otherwise set status 'complete',
    // clobbering 'recovered'. Writing it last makes the narrative status win.
    if (step.module === 'overview' && this.state
        && typeof this.state.updateLot === 'function') {
      this.state.updateLot(this._lotId, { status: 'recovered' });
    }

    // Closing beat: now that the final beat's payload (recovered status write +
    // closing river chip + injection) has actually landed, the story is complete.
    // _finish() is deferred to HERE (not notifyTick) so it runs AFTER the async
    // router.set → afterMount → _completeBeat chain resolves; clearing _playing any
    // earlier would make this very call's afterMount guard bail and drop the finale.
    const lastStep = this._steps[this._steps.length - 1];
    if (step === lastStep || step.tick === lastStep.tick) {
      this._finish();
    }
  }

  // Tick-bound deterministic injection per beat. Each value is a fixed manifest
  // constant (no PRNG draw at fire time), so replays are identical.
  _injectForStep(step, tick) {
    if (!this.dispatcher || typeof this.dispatcher.emit !== 'function') return;
    switch (step.module) {
      case 'spc':
        // out-of-control point — SPC subscribes 'spc.violation' → log + red mark.
        // hero:true rides the river's priority lane + earns the bright .hero-chip
        // tag (flag-driven; the river no longer guesses chips[0]).
        this.dispatcher.emit('spc.violation', {
          tick,
          rule: 1,
          parameter: 'Chamber pressure',
          value: 4.92,           // fixed excursion value (deterministic)
          lotId: this._lotId,
          hero: true,
        });
        break;
      case 'apc':
        // R2R adjustment — APC subscribes 'apc.adjustment' → adjustment animation.
        this.dispatcher.emit('apc.adjustment', {
          tick,
          lotId: this._lotId,
          delta: -2.3,           // pressure -2.3% (matches the manifest note)
          hero: true,
        });
        break;
      case 'yield': {
        // defect cluster — Yield subscribes 'defect.detected' → pareto + wafer map.
        // x/y are fixed (deterministic) so the cluster lands in the same spot.
        const dt = defectTypes.find((d) => d.id === this._defectType);
        this.dispatcher.emit('defect.detected', {
          tick,
          lotId: this._lotId,
          x: 0.18,
          y: -0.22,
          type: dt ? dt.id : this._defectType,
          hero: true,
        });
        break;
      }
      // overview: the 'recovered' status write happens at the END of _fireBeat
      // (after the lot.complete chip emit) so it is not clobbered back to
      // 'complete' by app.js's lot-lifecycle subscriber.
      default:
        break;
    }
  }

  // Push a bright story chip by emitting a real event the river already renders.
  _pushStoryChip(step, tick) {
    // the per-step injection above already emits the headline event for spc/apc/
    // yield; for mes/overview emit a lot.start/lot.complete style marker so the
    // river shows the narrative without inventing a new event type.
    if (!this.dispatcher || typeof this.dispatcher.emit !== 'function') return;
    // hero:true marks the chip so the river ranks it in the priority lane and tags
    // it .hero-chip at render time — flag-driven, NOT a chips[0] position guess.
    // The closing beat-5 'L-042 marked Recovered' lot.complete carries it too.
    if (step.module === 'mes') {
      this.dispatcher.emit('lot.start', {
        lotId: this._lotId, step: 'PHOTO', note: step.note, tick, hero: true,
      });
    } else if (step.module === 'overview') {
      this.dispatcher.emit('lot.complete', {
        lotId: this._lotId, note: step.note, tick, hero: true,
      });
    }
  }

  // -- topbar indicator ------------------------------------------------------

  _showIndicator() {
    const topbar = document.getElementById('topbar');
    if (!topbar) return;
    ensureStyles(topbar.ownerDocument || document);
    if (this._indicator) return;
    const doc = topbar.ownerDocument || document;
    const el = doc.createElement('div');
    el.className = 'hero-indicator';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const glyph = doc.createElement('span');
    glyph.className = 'hero-ind-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = '▶';
    const label = doc.createElement('span');
    label.className = 'hero-ind-label';
    label.textContent = this.t('hero.playing');
    el.appendChild(glyph);
    el.appendChild(label);
    topbar.appendChild(el);
    this._indicator = el;
  }

  _hideIndicator() {
    if (this._indicator && this._indicator.parentNode) {
      this._indicator.parentNode.removeChild(this._indicator);
    }
    this._indicator = null;
  }

  // -- caption overlay -------------------------------------------------------

  _showCaption(step) {
    const content = document.getElementById('content');
    if (!content) return;
    ensureStyles(content.ownerDocument || document);
    this._clearCaption(true);
    const doc = content.ownerDocument || document;
    const el = doc.createElement('div');
    el.className = 'hero-caption';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    const stepName = doc.createElement('span');
    stepName.className = 'hero-caption-step';
    // step name from i18n (hero.step.<module>); falls back to the route id label.
    stepName.textContent = this.t('hero.step.' + step.module);

    const note = doc.createElement('span');
    note.className = 'hero-caption-note';
    note.textContent = this.t('hero.note.' + step.module);

    el.appendChild(stepName);
    el.appendChild(note);
    content.appendChild(el);
    this._caption = el;

    // render-only removal timer (allowed for caption timing per the amended spec;
    // it does NOT drive any narrative step — beats are tick-driven). Fade then
    // remove. Under reduced motion the CSS animation is off, so it is a clean
    // appear/disappear with no movement.
    if (this._captionTimer) clearTimeout(this._captionTimer);
    this._captionTimer = setTimeout(() => this._clearCaption(false), CAPTION_MS);
  }

  // immediate=true removes at once (teardown); immediate=false plays the exit.
  _clearCaption(immediate) {
    if (this._captionTimer) { clearTimeout(this._captionTimer); this._captionTimer = null; }
    const el = this._caption;
    if (!el) return;
    if (immediate) {
      if (el.parentNode) el.parentNode.removeChild(el);
      this._caption = null;
      return;
    }
    el.classList.add('is-leaving');
    const remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
    // the exit is a short CSS transition; remove on the next macrotask. This is a
    // render-only timer, not a narrative driver.
    this._caption = null;
    setTimeout(remove, 200);
  }

  // -- river de-emphasis -----------------------------------------------------

  _dimRiver(on) {
    const river = document.getElementById('event-river');
    if (!river) return;
    ensureStyles(river.ownerDocument || document);
    river.classList.toggle('hero-dim', !!on);
    // NOTE: the .hero-chip tag is flag-driven (ev.hero, set at river render time),
    // so we do NOT strip it here — removing the dim envelope is enough. The hero
    // chips age out of the river on their own as new events arrive; manually
    // stripping the class would only flicker against the next _render() re-tag.
  }
}

// Factory: build + return the story controller. app.js wires notifyTick into its
// onTick fan-out and registers play/stop onto window.__SIM.
export function createHeroStory(opts) {
  return new HeroStory(opts);
}

export default createHeroStory;
