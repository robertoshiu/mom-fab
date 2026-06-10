// engine/tick-scheduler.js
// TickScheduler — drives the 1s simulation heartbeat, owns the epoch loop, and
// performs wall-clock catch-up with a SKIP-NOT-QUEUE policy (M4) so background
// tabs / slow machines never trigger a tick avalanche.
//
// Tick advance uses setInterval(1000ms); epoch timing is derived from
// performance.now() ONLY (never Date.now / new Date — see Must NOT do).
//
// ---------------------------------------------------------------------------
// 4A — epoch-reset sequence (OWNED BY TickScheduler). The scheduler owns the
// ORDER below; state.* / choreography are injected hook callbacks the
// SimulationController wires in (this module does NOT import state.js).
//
//    tick 179 末
//       │ freeze emits
//       ▼
//    [SNAPSHOT] state.snapshotForEpochReset()   ← H2 carryover (SPC/yield/FDC tails)
//       │
//       ▼
//    [CLEAR]    state.suppressOverrides.clear() ← T29 epoch-scoped user actions
//       │
//       ▼
//    [RESET]    currentTick=0, epochSeed 更新
//       │
//       ▼
//    [CHOREO]   1.2s choreographed 轉場 (T26)    ← emits 凍結中
//       │ choreography 完成
//       ▼
//    [RESUME]   resume emits → tick 0 正常發送
//
// 順序理由: snapshot 先於 clear (否則被 Hold 的 lot 在 carryover 裡復活);
//           snapshot 先於 reset (否則拿到空資料閃空)。
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = 1000;
const DEFAULT_EPOCH_LENGTH = 180;
const CHOREO_WINDOW_MS = 1200;

const NOOP = () => {};

function now() {
  // performance.now() is the only permitted clock here. Guard for non-browser
  // hosts that may lack a global `performance` (rare under node, but safe).
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return 0;
}

export class TickScheduler {
  constructor(hooks = {}) {
    this.epochLength = DEFAULT_EPOCH_LENGTH;
    this.currentTick = 0;
    this.epochStartTime = 0;
    this.epochSeed = 0;

    // Injected epoch-reset hook callbacks (scheduler owns the order, not these).
    // Each defaults to a no-op so the module runs head-less under node tests.
    this._hooks = {
      onFreeze: hooks.onFreeze || NOOP,            // (1) freeze dispatcher emits
      onSnapshot: hooks.onSnapshot || NOOP,        // (2) state.snapshotForEpochReset()
      onClearOverrides: hooks.onClearOverrides || NOOP, // (3) state.suppressOverrides.clear()
      onChoreography: hooks.onChoreography || NOOP, // (5) 1.2s choreographed 轉場
      onResume: hooks.onResume || NOOP,            // (6) resume emits
    };

    this._onTick = null;
    this._onEpochEnd = null;
    this._intervalId = null;
    this._paused = false;
    this._inEpochReset = false;
    this._choreoTimerId = null;

    this._visibilityHandler = null;

    this._tickLoop = this._tickLoop.bind(this);
  }

  // -- lifecycle ------------------------------------------------------------

  start(onTick, onEpochEnd) {
    this._onTick = typeof onTick === 'function' ? onTick : NOOP;
    this._onEpochEnd = typeof onEpochEnd === 'function' ? onEpochEnd : NOOP;
    this._paused = false;
    this.epochStartTime = now();
    if (this._intervalId === null) {
      this._intervalId = setInterval(this._tickLoop, TICK_INTERVAL_MS);
    }
    this._wireVisibility();
  }

  // M7: clearInterval AND release callback refs so a stopped scheduler holds no
  // closures (no module-switch closure leakage).
  stop() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    if (this._choreoTimerId !== null) {
      clearTimeout(this._choreoTimerId);
      this._choreoTimerId = null;
    }
    this._unwireVisibility();
    this._onTick = null;
    this._onEpochEnd = null;
    this._paused = false;
    this._inEpochReset = false;
  }

  pause() {
    this._paused = true;
  }

  resume() {
    if (this._paused) {
      this._paused = false;
      // Re-anchor the epoch clock so resume does not retro-fire skipped ticks.
      this.epochStartTime = now() - (this.currentTick * TICK_INTERVAL_MS);
    }
  }

  setEpochLength(n) {
    if (Number.isInteger(n) && n > 0) {
      this.epochLength = n;
    }
  }

  // -- tick advance ---------------------------------------------------------

  _tickLoop() {
    if (this._paused || this._inEpochReset) {
      return;
    }
    const next = this.currentTick + 1;
    if (next >= this.epochLength) {
      // tick (epochLength-1) → 0 : run the owned epoch-reset sequence.
      this._runEpochReset();
    } else {
      this.currentTick = next;
      this._emitTick(this.currentTick);
    }
  }

  _emitTick(tick) {
    if (this._onTick) {
      this._onTick(tick);
    }
  }

  // -- epoch reset (4A sequence; ORDER is owned here) -----------------------

  _runEpochReset() {
    this._inEpochReset = true;

    // (1) freeze dispatcher emits
    this._hooks.onFreeze();

    // signal the boundary to the controller (Acceptance: onEpochEnd fires once)
    if (this._onEpochEnd) {
      this._onEpochEnd();
    }

    // (2) snapshot BEFORE clear/reset (held lots must not revive; avoid empty flash)
    this._hooks.onSnapshot();

    // (3) clear epoch-scoped user override suppressions
    this._hooks.onClearOverrides();

    // (4) reset tick + advance epochSeed + re-anchor epoch clock
    this.currentTick = 0;
    this.epochSeed = (this.epochSeed + 1) >>> 0;
    this.epochStartTime = now();

    // (5) 1.2s choreographed transition (emits remain frozen during the window)
    this._hooks.onChoreography(CHOREO_WINDOW_MS);

    const finishReset = () => {
      this._choreoTimerId = null;
      this._inEpochReset = false;
      // (6) resume emits → tick 0 fires normally
      this._hooks.onResume();
      this._emitTick(0);
    };

    if (typeof setTimeout === 'function') {
      this._choreoTimerId = setTimeout(finishReset, CHOREO_WINDOW_MS);
    } else {
      finishReset();
    }
  }

  // -- wall-clock catch-up (M4: SKIP-NOT-QUEUE) -----------------------------

  // Compute where the wall clock says we should be and jump there ONCE.
  // No burst replay of intervening ticks.
  onVisibilityChange() {
    if (this._paused || this._inEpochReset) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    const elapsedMs = now() - this.epochStartTime;
    const targetTick = Math.floor(elapsedMs / TICK_INTERVAL_MS) % this.epochLength;
    if (targetTick !== this.currentTick) {
      this.currentTick = targetTick;
      this._emitTick(targetTick); // ← exactly ONE catch-up call, no avalanche
    }
  }

  // -- DOM wiring (guarded so the module loads under node) ------------------

  _wireVisibility() {
    if (typeof document === 'undefined' || this._visibilityHandler) {
      return;
    }
    this._visibilityHandler = () => this.onVisibilityChange();
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  _unwireVisibility() {
    if (typeof document !== 'undefined' && this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }
    this._visibilityHandler = null;
  }
}
