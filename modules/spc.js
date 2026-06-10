// modules/spc.js — SPC module (T18). THE reference screen.
// Mirrors design/reference-spc.html: X-bar control chart (sigma bands / UCL·CL·LCL /
// hollow points / violation pulse / live point) on top, R chart (subgroup range)
// below, Western Electric rule selector (8 independently-toggling checkboxes with
// live hit counts) on the right, and a violation-log table spanning the bottom.
//
// Module contract (T13): export default { id, label, init, update, destroy }.
// ctx = { state, dispatcher, t, router }.
//
// SPC samples: app.js does NOT emit them, so this module is the producer
// (plan: "you MAY add per-tick sample generation INSIDE your module update").
// State-first — we mutate state.spcSamples (via state.addSpcSample, FIFO cap 50)
// in update() BEFORE drawing. Each tick derives ONE subgroup (n=5) deterministically
// from deriveTickSeed("spc.xbar"|"spc.r", tick, epochSeed); the subgroup mean feeds
// the X-bar chart, its range feeds the R chart. A deterministic excursion at a
// fixed tick guarantees a WE Rule 1 violation so the demo always shows a red pulse.
//
// Charts: chart-kit createLineChart (control-limit options are native). No bespoke
// axis/tooltip scaffolding here. The only module-local CSS is chart text/skeleton
// styling that the shared sheet does not yet provide — injected token-only, scoped
// under #spc-root so nothing leaks. Reset clears the sliding window; Print preview
// is intentionally disabled (export locked per plan).

import { createLineChart } from '../components/chart-kit.js';
import { Table } from '../components/table.js';
import { deriveTickSeed } from '../engine/prng.js';
import { heroTimeline, toolGroups } from '../scenarios/mom-fab.js';

// ---------------------------------------------------------------------------
// Control-chart constants (mirror the reference artifact: chamber pressure mTorr).
// Domain identity comes from the scenario manifest — NOT hardcoded here:
//   - monitored product = the hero-story product (heroTimeline.product)
//   - monitored tool instance = the CVD tool group prefix + a fixed unit index
// Only the measured-parameter presentation strings (parameter name, unit) are
// local, since they are SPC presentation, not domain entities.
// ---------------------------------------------------------------------------
const CVD_GROUP = toolGroups.find((g) => g.id === 'CVD') || toolGroups[0];
const SPC_PRODUCT = heroTimeline.product;        // the lot the hero story follows
const SPC_PARAMETER = 'chamber_pressure';
const SPC_TOOL = `${CVD_GROUP.prefix}-07`;       // e.g. CVD-07 (manifest-derived)
const SUBGROUP_N = 5;              // n=5 per subgroup
const CL = 152;                    // centre line (mTorr)
// SIGMA is the σ of the PLOTTED statistic (the subgroup mean / X-bar point), so
// the chart control limits CL ± 3·SIGMA and the WE-rule zones are defined against
// the right quantity. The X-bar point is generated directly with this spread so
// points scatter across all zones (matching the reference shape) rather than
// hugging CL (which would falsely trip the stratification rules 7/8).
const SIGMA = 14;
const UCL = CL + 3 * SIGMA;
const LCL = CL - 3 * SIGMA;
const WINDOW = 50;                 // sliding window length
// R chart: within-subgroup σ relates to plotted σ by √n; constants for n=5.
const D2 = 2.326;                  // mean range / sigma_within for n=5
const SIGMA_WITHIN = SIGMA * Math.sqrt(SUBGROUP_N); // σ_within from σ_x̄
const RBAR = D2 * SIGMA_WITHIN;    // expected average range
const D3 = 0;                      // R-chart lower control factor (n=5 → 0)
const D4 = 2.114;                  // R-chart upper control factor (n=5)
const R_UCL = D4 * RBAR;
const R_LCL = D3 * RBAR;
// Deterministic excursion: at this window-relative position the X-bar point is
// pushed beyond +3σ so WE Rule 1 always fires (the reference uses i===38).
const EXCURSION_AT = 38;

// First sample lands around this tick (states.spc.empty advertises ~tick 6).
const FIRST_SAMPLE_TICK = 6;
const PREDICTED_TICK = 6;

// ---------------------------------------------------------------------------
// Western Electric rules. Each evaluator returns the SET of point indices that
// participate in a violation, given the series of {value} points and the zone
// boundaries. Highlighting is per-rule and toggled independently; a point is
// drawn as a violation if ANY *enabled* rule flags it.
// ---------------------------------------------------------------------------
const RULE_KEYS = [
  'spc.rule_1', 'spc.rule_2', 'spc.rule_3', 'spc.rule_4',
  'spc.rule_5', 'spc.rule_6', 'spc.rule_7', 'spc.rule_8',
];

function zone(v) {
  // signed sigma distance from CL
  return (v - CL) / SIGMA;
}

// Returns Set<index> of points flagged by rule `n` (1-based) over series `s`.
function evalRule(n, s) {
  const hits = new Set();
  const z = s.map((p) => zone(p.value));
  const N = z.length;
  switch (n) {
    case 1: // 1 point beyond 3σ
      for (let i = 0; i < N; i++) if (Math.abs(z[i]) > 3) hits.add(i);
      break;
    case 2: // 9 points in a row on the same side of CL
      for (let i = 8; i < N; i++) {
        const sign = Math.sign(z[i]) || 1;
        let run = true;
        for (let k = i - 8; k <= i; k++) if ((Math.sign(z[k]) || 1) !== sign) { run = false; break; }
        if (run) for (let k = i - 8; k <= i; k++) hits.add(k);
      }
      break;
    case 3: // 6 points in a row steadily increasing or decreasing
      for (let i = 5; i < N; i++) {
        let inc = true, dec = true;
        for (let k = i - 5; k < i; k++) {
          if (!(s[k + 1].value > s[k].value)) inc = false;
          if (!(s[k + 1].value < s[k].value)) dec = false;
        }
        if (inc || dec) for (let k = i - 5; k <= i; k++) hits.add(k);
      }
      break;
    case 4: // 14 points in a row alternating up/down
      for (let i = 13; i < N; i++) {
        let alt = true;
        for (let k = i - 13; k < i; k++) {
          const d1 = s[k + 1].value - s[k].value;
          const d0 = k > i - 13 ? s[k].value - s[k - 1].value : -d1;
          if (Math.sign(d1) === Math.sign(d0) || d1 === 0) { alt = false; break; }
        }
        if (alt) for (let k = i - 13; k <= i; k++) hits.add(k);
      }
      break;
    case 5: // 2 of 3 consecutive points beyond 2σ (same side)
      for (let i = 2; i < N; i++) {
        for (const side of [1, -1]) {
          const w = [z[i - 2], z[i - 1], z[i]];
          const c = w.filter((v) => side > 0 ? v > 2 : v < -2).length;
          if (c >= 2) { for (let k = i - 2; k <= i; k++) if ((side > 0 ? z[k] > 2 : z[k] < -2)) hits.add(k); }
        }
      }
      break;
    case 6: // 4 of 5 consecutive points beyond 1σ (same side)
      for (let i = 4; i < N; i++) {
        for (const side of [1, -1]) {
          let c = 0;
          for (let k = i - 4; k <= i; k++) if (side > 0 ? z[k] > 1 : z[k] < -1) c++;
          if (c >= 4) for (let k = i - 4; k <= i; k++) if (side > 0 ? z[k] > 1 : z[k] < -1) hits.add(k);
        }
      }
      break;
    case 7: // 15 points in a row within 1σ (either side)
      for (let i = 14; i < N; i++) {
        let inside = true;
        for (let k = i - 14; k <= i; k++) if (Math.abs(z[k]) >= 1) { inside = false; break; }
        if (inside) for (let k = i - 14; k <= i; k++) hits.add(k);
      }
      break;
    case 8: // 8 points in a row beyond 1σ (either side, none within 1σ)
      for (let i = 7; i < N; i++) {
        let outside = true;
        for (let k = i - 7; k <= i; k++) if (Math.abs(z[k]) < 1) { outside = false; break; }
        if (outside) for (let k = i - 7; k <= i; k++) hits.add(k);
      }
      break;
    default:
      break;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Deterministic per-tick sample generation. Builds the full sliding window for
// the current tick from scratch each call (idempotent, replayable). We rebuild
// rather than only-append so router.refreshActive() / re-mount never double-count.
// ---------------------------------------------------------------------------
// Approx-normal deviate in [-~3,+~3] via sum of 3 uniforms (std 0.5), scaled ×2
// → std ≈ 1. Same construction as the reference, tuned to fill the control zones.
function gauss(rng) {
  return (rng() + rng() + rng() - 1.5) * 2;
}

function subgroupAt(tick, epochSeed) {
  // X-bar point drawn directly with σ = SIGMA (the plotted statistic's σ); the
  // subgroup range drawn from an independent stream at σ_within. Two streams keep
  // the two charts statistically independent yet fully deterministic.
  const rx = deriveTickSeed('spc.xbar', tick, epochSeed);
  const rr = deriveTickSeed('spc.r', tick, epochSeed);
  const mean = CL + gauss(rx) * SIGMA;
  // range ~ RBAR ± jitter, never negative
  const range = Math.max(1, RBAR + gauss(rr) * (RBAR * 0.18));
  return { mean, range };
}

function buildWindow(tick, epochSeed) {
  // window covers the most recent WINDOW ticks ending at `tick`, but never before
  // FIRST_SAMPLE_TICK (so EMPTY/PARTIAL states are exercised early in the epoch).
  const xbar = [];
  const rseries = [];
  const start = Math.max(FIRST_SAMPLE_TICK, tick - WINDOW + 1);
  for (let tk = start; tk <= tick; tk++) {
    const g = subgroupAt(tk, epochSeed);
    let mean = g.mean;
    // deterministic excursion at the fixed window position so Rule 1 always fires
    const posFromStart = tk - start;
    if (posFromStart === EXCURSION_AT && (tick - start + 1) >= WINDOW) {
      mean = UCL + SIGMA * 0.55;
    }
    xbar.push({ tick: tk, value: Math.round(mean * 10) / 10 });
    rseries.push({ tick: tk, value: Math.round(g.range * 10) / 10 });
  }
  return { xbar, rseries };
}

// ---------------------------------------------------------------------------
// Scoped, token-only styles. The shared sheet does not yet style chart-kit text /
// skeleton / tooltip, so we provide the minimum here, scoped under #spc-root.
// Only var(--*) values + 1px hairline literals (allowed by the iron rules).
// ---------------------------------------------------------------------------
const STYLE_ID = 'spc-module-styles';
const CSS = `
#spc-root {
  display: grid;
  grid-template-columns: 1fr 300px;
  grid-template-rows: auto minmax(0, 1.35fr) minmax(0, 1fr);
  gap: var(--sp-3);
  height: 100%;
  min-height: 0;
}
#spc-head { grid-column: 1 / 3; display: flex; align-items: baseline; gap: var(--sp-3); }
#spc-head h1 { font-size: var(--fs-title); font-weight: var(--fw-emphasis); margin: 0; letter-spacing: 0.01em; }
#spc-head .en { color: var(--text-secondary); font-size: var(--fs-subtitle); font-weight: var(--fw-body); }
#spc-head .actions { margin-left: auto; display: flex; gap: var(--sp-2); align-items: center; }
#spc-tickmeter { font: var(--fw-body) var(--fs-caption) var(--font-mono); color: var(--text-secondary); }
#spc-tickmeter b { color: var(--accent); font-weight: var(--fw-kpi); }

#spc-root .panel-head {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--hairline);
}
#spc-root .panel-head .meta { margin-left: auto; font: var(--fw-body) var(--fs-caption) var(--font-mono); color: var(--text-secondary); }
#spc-root .panel-body { padding: var(--sp-3); min-height: 0; }

#spc-xbar, #spc-r { display: flex; flex-direction: column; min-height: 0; }
#spc-xbar .panel-body, #spc-r .panel-body { flex: 1; display: flex; min-height: 0; }
#spc-xbar .chartkit, #spc-r .chartkit { flex: 1; position: relative; min-height: 0; }
#spc-xbar svg, #spc-r svg { width: 100%; height: 100%; }

#spc-charts { display: grid; grid-template-rows: 1.4fr 1fr; gap: var(--sp-3); min-height: 0; }

#spc-rules .panel-body { display: flex; flex-direction: column; gap: 2px; }
#spc-rules .rule-row {
  display: flex; align-items: center; gap: var(--sp-2);
  font-size: var(--fs-body); padding: 3px 0; color: var(--text-secondary); cursor: pointer;
}
#spc-rules .rule-row input { accent-color: var(--accent); }
#spc-rules .rule-row.hit { color: var(--danger); }
#spc-rules .rule-row .num { margin-left: auto; font-size: var(--fs-caption); }

#spc-vlog { grid-column: 1 / 3; display: flex; flex-direction: column; min-height: 0; }
#spc-vlog .panel-body { padding: 0; min-height: 0; }
#spc-vlog .vtable { height: 100%; }
#spc-vlog .vtable-scroll { max-height: 100%; }

/* chart text + states (shared sheet gap fill, scoped) */
#spc-root .axis-t { font: var(--fw-body) var(--chart-axis-fs) var(--font-mono); fill: var(--text-secondary); }
#spc-root .limit-t { font: var(--fw-emphasis) var(--chart-axis-fs) var(--font-mono); }
#spc-root .ck-tooltip {
  position: absolute; pointer-events: none; opacity: 0;
  transform: translate(-50%, -130%); transition: opacity var(--transition);
  padding: var(--sp-1) var(--sp-2); background: var(--bg-elevated);
  border: 1px solid var(--hairline); border-radius: var(--r-card);
  font: var(--fw-body) var(--chart-tooltip-fs) var(--font-mono); color: var(--text-primary);
  box-shadow: var(--sh-md); white-space: nowrap; z-index: 5;
}
#spc-root .ck-tooltip.show { opacity: 1; }
#spc-root .chartkit-state {
  position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none;
}
#spc-root .chartkit-empty-msg {
  text-align: center; color: var(--text-secondary);
  font: var(--fw-body) var(--fs-body) var(--font-body); line-height: 1.6; padding: var(--sp-4);
}
#spc-root .chartkit-predict { color: var(--accent); font: var(--fw-body) var(--fs-caption) var(--font-mono); margin-top: var(--sp-1); }
#spc-root .chartkit-skeleton {
  position: absolute; inset: var(--sp-2); border-radius: var(--r-card);
  background: linear-gradient(100deg, var(--bg-inset) 30%, var(--bg-elevated) 50%, var(--bg-inset) 70%);
  background-size: 200% 100%; animation: spc-shimmer calc(var(--tick) * 1.5) linear infinite;
}
@keyframes spc-shimmer { to { background-position: -200% 0; } }

/* violation point pulse (live + violation) — aligned to the tick heartbeat */
#spc-root .ck-pt.spc-viol { animation: spc-viol-pulse calc(var(--tick) * 1.5) var(--ease-instrument) infinite; transform-origin: center; transform-box: fill-box; }
@keyframes spc-viol-pulse { 50% { transform: scale(1.7); opacity: 0.6; } }
#spc-root .ck-pt.spc-live { animation: spc-live-pulse var(--tick) var(--ease-instrument) infinite; }
@keyframes spc-live-pulse { 50% { opacity: 0.4; } }

@media (prefers-reduced-motion: reduce) {
  #spc-root .chartkit-skeleton,
  #spc-root .ck-pt.spc-viol,
  #spc-root .ck-pt.spc-live { animation: none; }
}

/* error banner — boot-banner vocabulary, inline */
#spc-root .spc-error {
  grid-column: 1 / 3; align-self: start;
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4); border-left: 2px solid var(--danger);
}
#spc-root .spc-error .label { color: var(--danger); }
#spc-root .spc-error .msg { color: var(--text-secondary); font-size: var(--fs-body); }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.setAttribute('data-module', 'spc');
  el.textContent = CSS;
  doc.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
const spc = {
  id: 'spc',
  label: 'spc.title',

  init(container, ctx) {
    const t = ctx.t;
    const doc = container.ownerDocument || document;
    ensureStyles(doc);

    // per-instance state
    this._ctx = ctx;
    this._enabledRules = new Set([1, 2, 3, 4, 5, 6, 7, 8]); // all on by default
    this._resetFloor = 0;     // ticks below this are excluded (Reset action)
    this._violations = [];    // violation-log rows (newest first)
    this._seenViolTicks = new Set();
    this._errored = false;
    this._lastTick = 0;
    this._lastFedTick = -1;   // last tick mirrored into state (idempotency guard)

    container.innerHTML = '';
    const root = doc.createElement('div');
    root.id = 'spc-root';
    container.appendChild(root);
    this._root = root;

    // --- module header ----------------------------------------------------
    const head = doc.createElement('div');
    head.id = 'spc-head';
    head.innerHTML =
      `<h1>${t('spc.title')}</h1>` +
      `<span class="badge badge-danger" id="spc-rulebadge" hidden></span>` +
      `<div class="actions">` +
      `<span id="spc-tickmeter">tick <b class="num">000</b><span style="opacity:.5">/180</span></span>` +
      `</div>`;
    root.appendChild(head);
    this._rulebadge = head.querySelector('#spc-rulebadge');
    this._tickmeter = head.querySelector('#spc-tickmeter b');

    // Reset (clears the window) + Print preview (locked/disabled per plan)
    const actions = head.querySelector('.actions');
    const resetBtn = doc.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn btn-ghost';
    resetBtn.setAttribute('data-i18n', 'spc.action.reset');
    resetBtn.textContent = t('spc.action.reset');
    resetBtn.addEventListener('click', () => {
      this._resetFloor = this._lastTick;          // mutate state-first
      this._violations = [];
      this._seenViolTicks.clear();
      this.update(container, this._ctx, this._lastTick); // idempotent re-reconcile
    });
    actions.appendChild(resetBtn);

    const printBtn = doc.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'btn';
    printBtn.textContent = 'Print preview';
    printBtn.disabled = true;                       // export locked
    printBtn.title = t('common.desktop_only');
    actions.appendChild(printBtn);

    // --- left column: X-bar (top) + R chart (bottom) ----------------------
    const charts = doc.createElement('div');
    charts.id = 'spc-charts';
    root.appendChild(charts);

    const xbarPanel = doc.createElement('div');
    xbarPanel.id = 'spc-xbar';
    xbarPanel.className = 'panel';
    xbarPanel.innerHTML =
      `<div class="panel-head"><span class="label">${t('spc.xbar_chart')} — Chamber Pressure</span>` +
      `<span class="badge badge-info">${SPC_TOOL}</span>` +
      `<span class="meta">n=${SUBGROUP_N} · ${WINDOW} · mTorr</span></div>` +
      `<div class="panel-body"></div>`;
    charts.appendChild(xbarPanel);
    this._xbarHost = xbarPanel.querySelector('.panel-body');

    const rPanel = doc.createElement('div');
    rPanel.id = 'spc-r';
    rPanel.className = 'panel';
    rPanel.innerHTML =
      `<div class="panel-head"><span class="label">${t('spc.r_chart')} — Range</span>` +
      `<span class="meta">n=${SUBGROUP_N} · R̄=${RBAR.toFixed(1)}</span></div>` +
      `<div class="panel-body"></div>`;
    charts.appendChild(rPanel);
    this._rHost = rPanel.querySelector('.panel-body');

    // chart-kit line charts with native control-limit options
    this._xbarChart = createLineChart({
      ucl: UCL, cl: CL, lcl: LCL, sigma: SIGMA,
      partialCapacity: WINDOW,
      emptyI18nKey: 'states.spc.empty',
      predictedTick: PREDICTED_TICK,
      ariaLabel: t('spc.xbar_chart'),
    }).render(this._xbarHost);

    this._rChart = createLineChart({
      ucl: R_UCL, cl: RBAR, lcl: R_LCL, sigma: RBAR / 3,
      partialCapacity: WINDOW,
      emptyI18nKey: 'states.spc.empty',
      predictedTick: PREDICTED_TICK,
      ariaLabel: t('spc.r_chart'),
    }).render(this._rHost);

    // --- right column: Western Electric rule selector ---------------------
    const side = doc.createElement('div');
    side.id = 'spc-rules';
    side.className = 'panel';
    side.innerHTML =
      `<div class="panel-head"><span class="label">Western Electric Rules</span></div>` +
      `<div class="panel-body"></div>`;
    root.appendChild(side);
    const rulesBody = side.querySelector('.panel-body');
    this._ruleRows = [];
    RULE_KEYS.forEach((key, idx) => {
      const n = idx + 1;
      const row = doc.createElement('label');
      row.className = 'rule-row';
      const cb = doc.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.setAttribute('aria-label', t(key));
      cb.addEventListener('change', () => {
        if (cb.checked) this._enabledRules.add(n);
        else this._enabledRules.delete(n);
        this.update(container, this._ctx, this._lastTick); // re-eval highlighting
      });
      const txt = doc.createElement('span');
      txt.className = 'rule-text';
      txt.setAttribute('data-i18n', key);
      txt.textContent = t(key);
      const num = doc.createElement('span');
      num.className = 'num';
      num.textContent = '—';
      row.appendChild(cb);
      row.appendChild(txt);
      row.appendChild(num);
      rulesBody.appendChild(row);
      this._ruleRows.push({ n, row, cb, num });
    });

    // --- bottom: violation log table --------------------------------------
    const vlog = doc.createElement('div');
    vlog.id = 'spc-vlog';
    vlog.className = 'panel';
    vlog.innerHTML =
      `<div class="panel-head"><span class="label">Violation Log</span>` +
      `<span class="meta" id="spc-vlog-meta">0</span></div>` +
      `<div class="panel-body"></div>`;
    root.appendChild(vlog);
    this._vlogMeta = vlog.querySelector('#spc-vlog-meta');
    this._vtable = Table({
      columns: [
        { key: 'tick', label: 'Tick', num: true },
        { key: 'rule', label: 'Rule', num: true },
        { key: 'parameter', label: 'Parameter' },
        { key: 'tool', label: 'Tool', num: true },
        { key: 'value', label: 'Value', num: true },
        {
          key: 'status', label: 'Status',
          render: (v) => {
            const span = doc.createElement('span');
            const led = doc.createElement('i');
            led.className = v === 'Open' ? 'led led-danger' : v === 'Review' ? 'led led-warn' : 'led led-ok';
            span.appendChild(led);
            span.appendChild(doc.createTextNode(' ' + v));
            return span;
          },
        },
      ],
      rows: [],
      ariaLabel: 'Violation Log',
    });
    vlog.querySelector('.panel-body').appendChild(this._vtable.el);

    // --- subscribe spc.violation: external violations (e.g. hero story) also
    //     land in the log + flash the header badge. Owner-scoped so destroy()'s
    //     unsubscribeAll(this.id) cleans it up. State-first: mutate, then patch.
    if (ctx.dispatcher && typeof ctx.dispatcher.subscribeAll === 'function') {
      ctx.dispatcher.subscribeAll(this.id, {
        'spc.violation': (payload) => {
          const p = payload || {};
          const key = `evt:${p.tick}:${p.rule || 1}`;
          if (this._seenViolTicks.has(key)) return;
          this._seenViolTicks.add(key);
          this._violations.unshift({
            tick: String(p.tick != null ? p.tick : this._lastTick).padStart(3, '0'),
            rule: `WE-${p.rule || 1}`,
            parameter: p.parameter || 'Chamber pressure',
            tool: p.tool || SPC_TOOL,
            value: p.value != null ? Number(p.value).toFixed(1) : '—',
            status: 'Open',
          });
          if (this._violations.length > 50) this._violations.length = 50;
          this._vtable.update({ rows: this._violations });
          if (this._vlogMeta) this._vlogMeta.textContent = String(this._violations.length);
        },
      });
    }

    // first reconcile
    this.update(container, ctx, 0);
  },

  update(container, ctx, tick) {
    if (!this._root) return;
    const t = ctx.t;
    this._lastTick = tick || 0;

    // tick meter
    if (this._tickmeter) this._tickmeter.textContent = String(this._lastTick).padStart(3, '0');

    // ERROR state: state store missing → inline boot-vocabulary banner.
    if (!ctx.state || typeof ctx.state.addSpcSample !== 'function') {
      this._renderError(container, t);
      return;
    }
    if (this._errored) { this._clearError(); this._errored = false; }

    const epochSeed = this._epochSeed();

    // --- state-first: (re)build the deterministic sliding window and fold it
    //     into the central store via addSpcSample (FIFO cap 50 enforced there).
    let xbar = [];
    let rseries = [];
    if (this._lastTick >= FIRST_SAMPLE_TICK) {
      const win = buildWindow(this._lastTick, epochSeed);
      // honour Reset: drop ticks at/below the reset floor
      xbar = win.xbar.filter((p) => p.tick >= this._resetFloor);
      rseries = win.rseries.filter((p) => p.tick >= this._resetFloor);
      // mirror newest sample into central state ONCE per tick — guard against
      // refreshActive() (locale change re-runs update for the same tick) so the
      // shared store is not double-fed. The chart itself rebuilds from
      // buildWindow(), so it is unaffected either way.
      const latest = xbar[xbar.length - 1];
      if (latest && latest.tick !== this._lastFedTick) {
        this._lastFedTick = latest.tick;
        ctx.state.addSpcSample({
          tick: latest.tick, product: SPC_PRODUCT, parameter: SPC_PARAMETER, value: latest.value,
        });
      }
    }

    // --- evaluate enabled WE rules → per-point violation flag + per-rule counts
    const flagged = new Set();           // indices flagged by ANY enabled rule
    const perRuleHits = new Map();       // n -> count of flagged points
    for (let n = 1; n <= 8; n++) {
      const hits = evalRule(n, xbar);
      perRuleHits.set(n, hits.size);
      if (this._enabledRules.has(n)) hits.forEach((i) => flagged.add(i));
    }

    // annotate points for chart-kit (d.violation drives the red filled point)
    const xbarData = xbar.map((p, i) => ({ value: p.value, tick: p.tick, violation: flagged.has(i) }));
    const rData = rseries.map((p) => ({ value: p.value, tick: p.tick }));

    // --- draw charts (chart-kit owns axis/limits/sigma/points) ------------
    this._xbarChart.update(xbarData);
    this._rChart.update(rData);
    this._decoratePoints();

    // --- rule rows: hit counts + .hit highlight on enabled+hitting rules ---
    this._ruleRows.forEach(({ n, row, num }) => {
      const c = perRuleHits.get(n) || 0;
      num.textContent = c > 0 ? String(c) : '—';
      row.classList.toggle('hit', c > 0 && this._enabledRules.has(n));
    });

    // --- header rule badge: count of enabled rule-1 violations (the loud one)
    const r1 = this._enabledRules.has(1) ? (perRuleHits.get(1) || 0) : 0;
    if (r1 > 0) {
      this._rulebadge.hidden = false;
      this._rulebadge.textContent = `${t('spc.rule_1').split(':')[0].trim()} · ${r1}`;
    } else {
      this._rulebadge.hidden = true;
    }

    // --- violation log: append newly-seen flagged points (newest first) ----
    xbar.forEach((p, i) => {
      if (!flagged.has(i)) return;
      if (this._seenViolTicks.has(p.tick)) return;
      this._seenViolTicks.add(p.tick);
      // which enabled rule(s) caught it → label with the lowest-numbered rule
      let ruleN = 1;
      for (let n = 1; n <= 8; n++) {
        if (this._enabledRules.has(n) && evalRule(n, xbar).has(i)) { ruleN = n; break; }
      }
      this._violations.unshift({
        tick: String(p.tick).padStart(3, '0'),
        rule: `WE-${ruleN}`,
        parameter: 'Chamber pressure',
        tool: SPC_TOOL,
        value: p.value.toFixed(1),
        status: 'Open',
      });
    });
    if (this._violations.length > 50) this._violations.length = 50;
    this._vtable.update({ rows: this._violations });
    if (this._vlogMeta) this._vlogMeta.textContent = String(this._violations.length);
  },

  // Tag chart-kit's points with our pulse classes (live last point, violations).
  _decoratePoints() {
    [this._xbarHost, this._rHost].forEach((host) => {
      if (!host) return;
      const pts = host.querySelectorAll('circle.ck-pt');
      pts.forEach((c, i) => {
        c.classList.remove('spc-viol', 'spc-live');
        const isLast = i === pts.length - 1;
        const isViol = c.getAttribute('fill') === 'var(--danger)';
        if (isViol) c.classList.add('spc-viol');
        else if (isLast) c.classList.add('spc-live');
      });
    });
  },

  _epochSeed() {
    try {
      if (typeof window !== 'undefined' && window.__SIM && window.__SIM.scheduler) {
        return window.__SIM.scheduler.epochSeed >>> 0;
      }
    } catch (_) { /* defensive */ }
    return 0;
  },

  _renderError(container, t) {
    this._errored = true;
    if (this._root.querySelector('.spc-error')) return;
    const doc = container.ownerDocument || document;
    const banner = doc.createElement('div');
    banner.className = 'spc-error panel';
    banner.setAttribute('role', 'alert');
    banner.innerHTML = `<span class="label">${t('states.error')}</span><span class="msg">${t('states.empty')}</span>`;
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.setAttribute('data-i18n', 'states.action.retry');
    retry.textContent = t('states.action.retry');
    retry.addEventListener('click', () => this.update(container, this._ctx, this._lastTick));
    banner.appendChild(retry);
    this._root.appendChild(banner);
  },

  _clearError() {
    const b = this._root && this._root.querySelector('.spc-error');
    if (b) b.remove();
  },

  destroy() {
    if (this._xbarChart) { this._xbarChart.destroy(); this._xbarChart = null; }
    if (this._rChart) { this._rChart.destroy(); this._rChart = null; }
    if (this._vtable) { this._vtable.destroy(); this._vtable = null; }
    if (this._ctx && this._ctx.dispatcher) this._ctx.dispatcher.unsubscribeAll(this.id);
    this._root = null;
    this._ctx = null;
    this._ruleRows = null;
    this._violations = null;
    this._seenViolTicks = null;
  },
};

export default spc;
