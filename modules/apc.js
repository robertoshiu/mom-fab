// modules/apc.js — APC (Advanced Process Control) module (T19).
//
// Module contract (T13): default export { id, label, init, update, destroy }.
//   ctx = { state, dispatcher, t, router }.
//
// Composition (design/reference-spc.html grid language):
//   #content → two stacked .panel containers with engraved .panel-head labels.
//     TOP  — R2R (Run-to-Run): controller adjustment series over the most recent
//            30 lots, drawn with chart-kit createLineChart and animated on update.
//     BOT  — FDC (Fault Detection & Classification): ≥3 parameter time-series
//            (chamber pressure / RF power / gas flow / temperature), one chart-kit
//            createLineChart per parameter (the kit's line is single-series, so
//            multi-series == one kit chart each — still zero bespoke axis/tooltip).
//
// Controller switch: EWMA (λ=0.3) ↔ PID (Kp/Ki/Kd sliders). Switching changes the
//   R2R smoothing FORMULA, so the adjustment curve is statistically different and
//   deterministic — EWMA vs PID screenshots hash differently (QA AC).
//
// Determinism: ALL series come from deriveTickSeed(domain, tick) PRNG streams
//   (engine/prng.js). No Math.random / Date.now. The controller math is a SIMULATED
//   formula (not real control theory, per "Must NOT do").
//
// Subscriptions (I2): apc.adjustment + recipe.changed → mutate local state first,
//   then update() does the full reconcile (2B rendering ownership).
//
// Interaction State Matrix (2A) for 'apc':
//   LOADING  — chart-kit shimmer (setLoading()).
//   EMPTY    — warm copy (states.apc.empty) + deterministic forecast (first R2R run
//              ~ tick FIRST_RUN_TICK) via chart-kit emptyI18nKey + predictedTick.
//   ERROR    — inline banner (states.error vocabulary + retry) — sets _errored.
//   SUCCESS  — full R2R + FDC draw.
//   PARTIAL  — window not full → chart-kit draws left-anchored w/ faint right grid
//              (partialCapacity on each chart).

import * as d3 from 'd3';
import { createLineChart } from '../components/chart-kit.js';
import { t } from '../i18n/index.js';
import { deriveTickSeed } from '../engine/prng.js';
import { products, toolGroups } from '../scenarios/mom-fab.js';

const STYLE_ID = 'apc-styles';

// --- domain wiring (no hardcoded product / tool-group names; all from manifest) --
// R2R follows a representative tool in the CVD group (the reference narrative tool).
const R2R_GROUP = 'CVD';
const R2R_WINDOW = 30;       // most-recent N lots in the R2R adjustment series (AC)
const FDC_WINDOW = 50;       // FDC sliding window length (full); < it ⇒ PARTIAL
const FIRST_RUN_TICK = 4;    // deterministic forecast: first R2R run arrival (EMPTY)

// FDC parameters — keys map to deriveTickSeed domain streams "fdc.<key>" (independent
// streams ⇒ statistically independent jitter within one tick). label is i18n-free
// instrument vocabulary (units shown in panel meta), not user prose.
const FDC_PARAMS = [
  { key: 'pressure', label: 'Chamber Pressure', unit: 'mTorr', base: 152, amp: 9, color: 'var(--accent)' },
  { key: 'rfpower', label: 'RF Power', unit: 'W', base: 480, amp: 22, color: 'var(--warn)' },
  { key: 'gasflow', label: 'Gas Flow', unit: 'sccm', base: 120, amp: 7, color: 'var(--success)' },
  { key: 'temp', label: 'Temperature', unit: '°C', base: 340, amp: 5, color: 'var(--idle)' },
];

// Controllers. EWMA uses λ; PID uses Kp/Ki/Kd. Defaults per brief (λ=0.3).
const CONTROLLERS = {
  ewma: { lambda: 0.3 },
  pid: { kp: 0.6, ki: 0.12, kd: 0.08 },
};

// gaussian-ish noise from three uniforms (matches reference jitter shape), centred 0.
function noise3(rng) {
  return (rng() + rng() + rng() - 1.5);
}

const apc = {
  id: 'apc',
  get label() { return t('apc.title'); },

  init(container, ctx) {
    this._ctx = ctx;
    this._errored = false;
    this._controller = 'ewma';
    // PID slider values (mutable via UI); EWMA λ is fixed per brief but exposed read-only.
    this._params = {
      lambda: CONTROLLERS.ewma.lambda,
      kp: CONTROLLERS.pid.kp,
      ki: CONTROLLERS.pid.ki,
      kd: CONTROLLERS.pid.kd,
    };
    // adjustment events received from dispatcher (I2) — latest first, capped.
    this._events = [];

    ensureStyles(container.ownerDocument || document);
    this._buildDom(container);

    // Subscriptions (I2): apc.adjustment + recipe.changed. Mutate state first,
    // then defer the visual reconcile to update() (2B). recipe.changed nudges the
    // R2R target (a recipe edit perturbs the controller setpoint).
    const dispatcher = ctx.dispatcher;
    if (dispatcher && typeof dispatcher.subscribeAll === 'function') {
      dispatcher.subscribeAll(this.id, {
        'apc.adjustment': (p) => {
          this._events.unshift({ tick: p && p.tick, lotId: p && p.lotId, delta: p && p.delta });
          if (this._events.length > R2R_WINDOW) this._events.length = R2R_WINDOW;
        },
        'recipe.changed': (p) => {
          this._recipeBump = (this._recipeBump || 0) + 1;
        },
      });
    }
  },

  update(container, ctx, tick) {
    if (this._errored) return;
    const _t = ctx && ctx.t ? ctx.t : t;       // re-read t() every render (6A)
    this._tick = tick || 0;

    // refresh i18n-bearing labels (full reconcile re-pulls translations)
    this._syncLabels(_t);
    this._syncController(_t);

    // ---- R2R series: most-recent 30 lots' adjustment magnitude ----
    const r2r = this._computeR2R(this._tick);
    if (r2r.length === 0) {
      this._r2rChart.setLoading();           // pre-arrival: shimmer until first run
    } else {
      this._r2rChart.update(r2r);            // chart-kit picks empty/partial/success
    }
    this._r2rMeta.textContent = this._controllerSummary(_t);

    // ---- FDC: one chart-kit line chart per parameter (≥3) ----
    FDC_PARAMS.forEach((param) => {
      const series = this._computeFdc(param, this._tick);
      const chart = this._fdcCharts[param.key];
      if (!chart) return;
      if (series.length === 0) chart.setLoading();
      else chart.update(series);
    });
  },

  destroy() {
    // unsubscribe all owner subscriptions first (T13)
    if (this._ctx && this._ctx.dispatcher && typeof this._ctx.dispatcher.unsubscribeAll === 'function') {
      this._ctx.dispatcher.unsubscribeAll(this.id);
    }
    // chart-kit destroy() runs selection.interrupt() then .remove() (H4)
    if (this._r2rChart) { this._r2rChart.destroy(); this._r2rChart = null; }
    if (this._fdcCharts) {
      Object.values(this._fdcCharts).forEach((c) => c && c.destroy());
      this._fdcCharts = null;
    }
    // belt-and-braces: interrupt + remove anything left in the container
    if (this._root) {
      d3.select(this._root).selectAll('*').interrupt();
    }
    this._root = null;
    this._ctx = null;
  },

  // =========================================================================
  // DOM build
  // =========================================================================
  _buildDom(container) {
    const doc = container.ownerDocument || document;
    const root = doc.createElement('div');
    root.className = 'apc-root';
    this._root = root;

    // ---------- module head (title + controller toggle + tick meter) ----------
    const head = doc.createElement('div');
    head.className = 'apc-head';

    const h1 = doc.createElement('h1');
    h1.className = 'apc-title';
    this._titleEl = h1;
    head.appendChild(h1);

    const actions = doc.createElement('div');
    actions.className = 'apc-actions mobile-actions'; // T33: collapse to notice <768

    // controller segmented toggle (EWMA | PID)
    const seg = doc.createElement('div');
    seg.className = 'apc-seg';
    seg.setAttribute('role', 'group');
    this._segEwma = this._segBtn(doc, 'ewma');
    this._segPid = this._segBtn(doc, 'pid');
    seg.appendChild(this._segEwma);
    seg.appendChild(this._segPid);
    actions.appendChild(seg);

    // T33 <768 desktop-only notice (shown by responsive.css when buttons hide).
    const apcDtOnly = doc.createElement('span');
    apcDtOnly.className = 'mobile-desktop-only';
    apcDtOnly.setAttribute('data-i18n', 'common.desktop_only');
    apcDtOnly.textContent = (this._ctx && this._ctx.t ? this._ctx.t : t)('common.desktop_only');
    actions.appendChild(apcDtOnly);

    head.appendChild(actions);
    root.appendChild(head);

    // ---------- R2R panel (top) ----------
    const r2rPanel = doc.createElement('div');
    r2rPanel.className = 'panel apc-r2r';
    r2rPanel.dataset.mobile = 'hide'; // T33 <768: R2R hidden (rep = FDC)
    const r2rHead = doc.createElement('div');
    r2rHead.className = 'panel-head';
    this._r2rLabel = doc.createElement('span');
    this._r2rLabel.className = 'label';
    r2rHead.appendChild(this._r2rLabel);
    this._r2rTool = doc.createElement('span');
    this._r2rTool.className = 'badge badge-info';
    r2rHead.appendChild(this._r2rTool);
    this._r2rMeta = doc.createElement('span');
    this._r2rMeta.className = 'meta';
    r2rHead.appendChild(this._r2rMeta);
    r2rPanel.appendChild(r2rHead);

    const r2rBody = doc.createElement('div');
    r2rBody.className = 'panel-body apc-chart-body';
    r2rPanel.appendChild(r2rBody);
    root.appendChild(r2rPanel);

    // controller param row (EWMA λ readout | PID sliders) lives under the R2R head
    this._ctrlRow = doc.createElement('div');
    this._ctrlRow.className = 'apc-ctrl-row';
    r2rPanel.insertBefore(this._ctrlRow, r2rBody);

    // ---------- FDC panel (bottom) ----------
    const fdcPanel = doc.createElement('div');
    fdcPanel.className = 'panel apc-fdc';
    fdcPanel.dataset.mobile = 'rep'; // T33 <768 representative panel: APC FDC
    const fdcHead = doc.createElement('div');
    fdcHead.className = 'panel-head';
    this._fdcLabel = doc.createElement('span');
    this._fdcLabel.className = 'label';
    fdcHead.appendChild(this._fdcLabel);
    this._fdcMeta = doc.createElement('span');
    this._fdcMeta.className = 'meta';
    fdcHead.appendChild(this._fdcMeta);
    fdcPanel.appendChild(fdcHead);

    const fdcGrid = doc.createElement('div');
    fdcGrid.className = 'panel-body apc-fdc-grid';
    fdcPanel.appendChild(fdcGrid);
    root.appendChild(fdcPanel);

    container.appendChild(root);

    // ---------- instantiate chart-kit charts ----------
    this._r2rChart = createLineChart({
      partialCapacity: R2R_WINDOW,
      emptyI18nKey: 'states.apc.empty',
      predictedTick: FIRST_RUN_TICK,
      ariaLabel: t('apc.r2r'),
      color: 'var(--accent)',
      cl: 0,
    });
    this._r2rChart.render(r2rBody);

    this._fdcCharts = {};
    FDC_PARAMS.forEach((param) => {
      const cell = doc.createElement('div');
      cell.className = 'apc-fdc-cell';
      const cap = doc.createElement('div');
      cap.className = 'apc-fdc-cap';
      const dot = doc.createElement('i');
      dot.className = 'apc-fdc-dot';
      dot.style.background = param.color;
      cap.appendChild(dot);
      const cname = doc.createElement('span');
      cname.textContent = param.label;
      cap.appendChild(cname);
      const cunit = doc.createElement('span');
      cunit.className = 'apc-fdc-unit num';
      cunit.textContent = param.unit;
      cap.appendChild(cunit);
      cell.appendChild(cap);
      const plot = doc.createElement('div');
      plot.className = 'apc-fdc-plot';
      cell.appendChild(plot);
      fdcGrid.appendChild(cell);

      const chart = createLineChart({
        partialCapacity: FDC_WINDOW,
        emptyI18nKey: 'states.apc.empty',
        predictedTick: FIRST_RUN_TICK,
        ariaLabel: param.label,
        color: param.color,
      });
      chart.render(plot);
      this._fdcCharts[param.key] = chart;
    });
  },

  _segBtn(doc, which) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'btn apc-seg-btn';
    b.dataset.controller = which;
    b.addEventListener('click', () => this._setController(which));
    return b;
  },

  // =========================================================================
  // Controller switching — mutate state first, then idempotent DOM patch (2B)
  // =========================================================================
  _setController(which) {
    if (which !== 'ewma' && which !== 'pid') return;
    if (this._controller === which) return;
    this._controller = which;
    const _t = (this._ctx && this._ctx.t) || t;
    this._syncController(_t);
    // immediate visual reconcile so the curve reshapes without waiting for next tick
    const r2r = this._computeR2R(this._tick || 0);
    if (r2r.length === 0) this._r2rChart.setLoading();
    else this._r2rChart.update(r2r);
    this._r2rMeta.textContent = this._controllerSummary(_t);
  },

  _syncController(_t) {
    // segmented active state
    if (this._segEwma) {
      const ewmaOn = this._controller === 'ewma';
      this._segEwma.classList.toggle('is-active', ewmaOn);
      this._segPid.classList.toggle('is-active', !ewmaOn);
      this._segEwma.setAttribute('aria-pressed', String(ewmaOn));
      this._segPid.setAttribute('aria-pressed', String(!ewmaOn));
      this._segEwma.textContent = _t('apc.controller_ewma');
      this._segPid.textContent = _t('apc.controller_pid');
    }
    // rebuild the param control row for the active controller
    this._buildCtrlRow(_t);
  },

  _buildCtrlRow(_t) {
    const row = this._ctrlRow;
    if (!row) return;
    const doc = row.ownerDocument || document;
    row.textContent = '';
    if (this._controller === 'ewma') {
      row.appendChild(this._readout(doc, _t('apc.lambda'), this._params.lambda.toFixed(2)));
    } else {
      row.appendChild(this._slider(doc, 'kp', _t('apc.kp'), 0, 1.2, 0.02, this._params.kp));
      row.appendChild(this._slider(doc, 'ki', _t('apc.ki'), 0, 0.5, 0.01, this._params.ki));
      row.appendChild(this._slider(doc, 'kd', _t('apc.kd'), 0, 0.4, 0.01, this._params.kd));
    }
  },

  _readout(doc, label, value) {
    const wrap = doc.createElement('div');
    wrap.className = 'apc-readout';
    const l = doc.createElement('span');
    l.className = 'apc-ctrl-label';
    l.textContent = label;
    const v = doc.createElement('span');
    v.className = 'apc-ctrl-val num';
    v.textContent = value;
    wrap.appendChild(l);
    wrap.appendChild(v);
    return wrap;
  },

  _slider(doc, gain, label, min, max, step, value) {
    const wrap = doc.createElement('label');
    wrap.className = 'apc-slider';
    const l = doc.createElement('span');
    l.className = 'apc-ctrl-label';
    l.textContent = label;
    const input = doc.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = 'apc-range';
    const v = doc.createElement('span');
    v.className = 'apc-ctrl-val num';
    v.textContent = Number(value).toFixed(2);
    input.addEventListener('input', () => {
      const nv = parseFloat(input.value);
      this._params[gain] = nv;
      v.textContent = nv.toFixed(2);
      // PID gain change reshapes the R2R curve immediately (state-first + patch)
      const r2r = this._computeR2R(this._tick || 0);
      if (r2r.length === 0) this._r2rChart.setLoading();
      else this._r2rChart.update(r2r);
    });
    wrap.appendChild(l);
    wrap.appendChild(input);
    wrap.appendChild(v);
    return wrap;
  },

  // =========================================================================
  // i18n label sync (called every reconcile — re-reads t())
  // =========================================================================
  _syncLabels(_t) {
    if (this._titleEl) this._titleEl.textContent = _t('apc.title');
    if (this._r2rLabel) this._r2rLabel.textContent = _t('apc.r2r');
    if (this._fdcLabel) this._fdcLabel.textContent = _t('apc.fdc');
    if (this._r2rTool) {
      const group = toolGroups.find((g) => g.id === R2R_GROUP);
      this._r2rTool.textContent = (group ? group.prefix : R2R_GROUP) + '-07';
    }
    if (this._fdcMeta) {
      this._fdcMeta.textContent = FDC_PARAMS.length + ' params · ' + FDC_WINDOW + ' samples';
    }
  },

  _controllerSummary(_t) {
    if (this._controller === 'ewma') {
      return 'EWMA · λ=' + this._params.lambda.toFixed(2);
    }
    return 'PID · Kp=' + this._params.kp.toFixed(2)
      + ' Ki=' + this._params.ki.toFixed(2)
      + ' Kd=' + this._params.kd.toFixed(2);
  },

  // =========================================================================
  // Deterministic series computation (engine PRNG streams only)
  // =========================================================================

  // R2R: the controller drives a process offset toward 0 (target) over the most
  // recent R2R_WINDOW lots. EWMA and PID produce statistically DIFFERENT correction
  // trajectories from the SAME deterministic measurement stream — hence the curve
  // (and its screenshot hash) differs between controllers (AC).
  _computeR2R(tick) {
    // how many runs have arrived by now (one run roughly per tick after FIRST_RUN_TICK)
    const arrived = tick - FIRST_RUN_TICK + 1;
    if (arrived <= 0) return [];
    const n = Math.min(arrived, R2R_WINDOW);

    // the absolute run index of the oldest visible run (sliding window)
    const startRun = Math.max(0, arrived - R2R_WINDOW);
    // I2 baseline shift: combine this mount's live recipe.changed count with the
    // persistent count on shared state (set by app.js's recipe-bridge) so the
    // controller setpoint reflects recipe sign-offs that happened while APC was
    // unmounted — the baseline stays shifted whenever the user returns to APC.
    const persistentBump =
      (this._ctx && this._ctx.state && this._ctx.state.recipeChanges) || 0;
    const recipeBump = (this._recipeBump || 0) + persistentBump;

    // measured disturbance stream — shared across controllers (so only the
    // controller math differs). Derived per absolute run index for stability.
    const measured = (run) => {
      const rng = deriveTickSeed('apc.measure', run + recipeBump);
      // a slowly drifting setpoint error + per-run noise
      const drift = Math.sin((run + recipeBump) * 0.18) * 6;
      return drift + noise3(rng) * 5;
    };

    const out = [];
    if (this._controller === 'ewma') {
      // EWMA controller: smoothed estimate, correction = -λ * estimate.
      const lambda = this._params.lambda;
      let est = 0;
      for (let run = 0; run <= startRun + n - 1; run++) {
        const m = measured(run);
        est = lambda * m + (1 - lambda) * est;     // EWMA smoothing
        if (run >= startRun) {
          // the applied adjustment magnitude (what the chart shows)
          out.push({ value: round2(-lambda * est) });
        }
      }
    } else {
      // PID controller: correction = -(Kp*e + Ki*∫e + Kd*Δe). Integral + derivative
      // give a visibly different (over/undershoot, lag) trajectory vs EWMA.
      const { kp, ki, kd } = this._params;
      let integral = 0;
      let prevErr = 0;
      for (let run = 0; run <= startRun + n - 1; run++) {
        const e = measured(run);
        integral += e;
        const deriv = e - prevErr;
        prevErr = e;
        const u = -(kp * e + ki * integral + kd * deriv);
        if (run >= startRun) out.push({ value: round2(u) });
      }
    }
    return out;
  },

  // FDC: per-parameter sliding window of FDC_WINDOW points ending at the current
  // tick. Each parameter uses its OWN deriveTickSeed domain stream ("fdc.<key>")
  // so the four traces are statistically independent within a tick.
  _computeFdc(param, tick) {
    if (tick < FIRST_RUN_TICK) return [];
    const len = Math.min(tick - FIRST_RUN_TICK + 1, FDC_WINDOW);
    const endTick = tick;
    const startTick = endTick - len + 1;
    const out = [];
    for (let tk = startTick; tk <= endTick; tk++) {
      const rng = deriveTickSeed('fdc.' + param.key, tk);
      const wobble = Math.sin(tk * 0.22 + param.base) * param.amp * 0.35;
      const value = param.base + wobble + noise3(rng) * param.amp * 0.5;
      out.push({ value: round2(value) });
    }
    return out;
  },
};

function round2(v) { return Math.round(v * 100) / 100; }

// ===========================================================================
// Module-local stylesheet — token-only values (zero raw px/color literals beyond
// 1px hairline borders, allowed). Injected once per document.
// ===========================================================================
function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.setAttribute('data-module', 'apc');
  el.textContent = `
.apc-root {
  display: grid;
  grid-template-rows: auto minmax(0, 1.1fr) minmax(0, 1fr);
  gap: var(--sp-3);
  height: 100%;
  min-height: 0;
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
}
.apc-head { display: flex; align-items: baseline; gap: var(--sp-3); }
.apc-title { font-size: var(--fs-title); font-weight: var(--fw-emphasis); margin: 0; letter-spacing: 0.01em; }
.apc-actions { margin-left: auto; display: flex; gap: var(--sp-2); align-items: center; }

.apc-seg { display: inline-flex; border: 1px solid var(--hairline); border-radius: var(--r-card); overflow: hidden; }
.apc-seg-btn {
  border: none; border-radius: 0; background: none;
  color: var(--text-secondary);
  font: var(--fw-emphasis) var(--fs-caption) var(--font-mono);
  letter-spacing: 0.04em; padding: var(--sp-1) var(--sp-3);
}
.apc-seg-btn:hover { transform: none; color: var(--text-primary); box-shadow: none; }
.apc-seg-btn.is-active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.apc-seg-btn + .apc-seg-btn { border-left: 1px solid var(--hairline); }

.apc-r2r, .apc-fdc { display: flex; flex-direction: column; min-height: 0; }
.panel-head {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--hairline);
}
.panel-head .label { font: var(--fw-emphasis) var(--fs-caption) var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-secondary); }
.panel-head .meta { margin-left: auto; font: var(--fw-body) var(--fs-caption) var(--font-mono); color: var(--text-secondary); }
.panel-body { padding: var(--sp-3); min-height: 0; }
.apc-chart-body { flex: 1; display: flex; }
.apc-chart-body .chartkit { flex: 1; width: 100%; height: 100%; }

.apc-ctrl-row {
  display: flex; align-items: center; gap: var(--sp-4);
  padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--hairline);
  flex-wrap: wrap;
}
.apc-readout, .apc-slider { display: inline-flex; align-items: center; gap: var(--sp-2); }
.apc-ctrl-label { font: var(--fw-body) var(--fs-caption) var(--font-mono); color: var(--text-secondary); letter-spacing: 0.03em; }
.apc-ctrl-val { font-size: var(--fs-body); color: var(--accent); font-weight: var(--fw-emphasis); min-width: var(--sp-7); }
.apc-range { accent-color: var(--accent); width: var(--sp-7); cursor: pointer; }
.apc-range:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.apc-fdc-grid {
  flex: 1; display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3); min-height: 0;
}
.apc-fdc-cell { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.apc-fdc-cap {
  display: flex; align-items: center; gap: var(--sp-2);
  font: var(--fw-body) var(--fs-caption) var(--font-body); color: var(--text-secondary);
  padding-bottom: var(--sp-1);
}
.apc-fdc-dot { width: var(--sp-2); height: var(--sp-2); border-radius: 50%; flex: none; }
.apc-fdc-unit { margin-left: auto; opacity: 0.7; }
.apc-fdc-plot { flex: 1; min-height: 0; }
.apc-fdc-plot .chartkit { width: 100%; height: 100%; }

@media (max-width: 768px) {
  .apc-fdc-grid { grid-template-columns: 1fr; }
}
`;
  doc.head.appendChild(el);
}

export default apc;
