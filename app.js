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
  const dispatcher = new Dispatcher();

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
  dispatcher.subscribeAll('lot-lifecycle', {
    'lot.start': (p) => state.updateLot(p.lotId, { status: 'running' }),
    'step.transition': (p) => state.updateLot(p.lotId, { status: 'running' }),
    'material.in_transit': (p) => state.updateLot(p.lotId, { status: 'in_process' }),
    'lot.complete': (p) => state.updateLot(p.lotId, { status: 'complete' }),
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
  // 6A: locale change re-runs the active module's full reconcile so SVG/canvas
  // text re-pulls t(key) (the [data-i18n] DOM scan can't reach inside charts).
  onLocaleChange(() => router.refreshActive());

  // --- TickScheduler with epoch-reset hooks wired in T4's order contract ---
  // The scheduler OWNS the order (snapshot → clear → reset → choreo → resume);
  // we only supply the callbacks. Choreography is a null-op until T26/T30.
  const scheduler = new TickScheduler({
    onFreeze: () => {},
    onSnapshot: () => state.snapshotForEpochReset(),
    onClearOverrides: () => state.suppressOverrides.clear(),
    onChoreography: () => {}, // TODO(T26/T30): 1.2s choreographed transition
    onResume: () => {},
  });

  // --- the per-tick drive ---------------------------------------------------
  function emitSkeletonTick(tick) {
    const slot = skeleton[tick];
    if (!slot) return;
    for (const ev of slot.events) {
      if (KNOWN_EVENT_TYPES.has(ev.type)) {
        dispatcher.emit(ev.type, ev.payload);
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
