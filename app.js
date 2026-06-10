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
import i18n, { setLocale, applyDom, t } from './i18n/index.js';

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

  // --- engine assembly ------------------------------------------------------
  const state = new SimulationState();
  const dispatcher = new Dispatcher();

  // Deterministic domain data + lifecycle skeleton.
  const { lots, equipment, recipes } = pregenerate();
  state.load({ lots, equipment, recipes });
  const skeleton = generateSkeleton(lots, equipment, recipes);

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
  }

  scheduler.start(onTick, () => {});

  // --- window.__SIM 8-key contract (3A) ------------------------------------
  // router / d3 / playHeroStory / stopHeroStory are null-stub placeholders;
  // later tasks register themselves onto __SIM. setEpochLength delegates to the
  // scheduler so QA can shorten epochs deterministically.
  window.__SIM = {
    scheduler,
    router: null,          // TODO(T13): SPA router registers here
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
