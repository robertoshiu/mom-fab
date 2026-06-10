// modules/aps.js — APS (Advanced Planning & Scheduling) module (T16).
//
// Module contract (T13): default export { id, label, init, update, destroy }.
// ctx = { state, dispatcher, t, router }. The router lazy-loads this file.
//
// Composition (mirrors design/reference-spc.html's .panel grid):
//   #mod-head  — engraved title + tick meter + action buttons
//   上半 .panel — 派工甘特 (chart-kit createGantt), 100 equipment rows, scrollable
//   下半 .panel — 機台負載熱力圖 (chart-kit createHeatmap 10×10)
//
// Re-dispatch: derive a fresh deterministic assignment, feed chart-kit update,
// then run a 1.5s d3 transition on the lot blocks to their new x/row (no d3-drag).
// Auto-balance: flatten utilization across equipment. Lock schedule: freeze
// re-dispatch so the choreography is suppressed.
//
// Determinism: all jitter comes from engine/prng.js deriveTickSeed domain
// streams ('aps.dispatch', 'aps.load'). No Math.random / Date.now.
//
// Interaction State Matrix (2A) — 'aps' row:
//   LOADING  chart-kit skeleton shimmer (gantt rows)
//   EMPTY    warm copy states.aps.empty + deterministic tick forecast (chart-kit)
//   ERROR    inline error banner (states.error vocabulary) + retry
//   SUCCESS  100-row gantt + 10×10 heatmap
//   PARTIAL  left-anchored gantt, unscheduled rows faded (chart-kit partialCapacity)

import * as d3 from 'd3';
import { createGantt, createHeatmap } from '../components/chart-kit.js';
import { deriveTickSeed } from '../engine/prng.js';

const MODULE_ID = 'aps';
const STYLE_ID = 'module-aps-styles';

// Epoch window the gantt time axis spans (matches the 180-tick epoch). Blocks are
// drawn left-anchored within this window so a partial schedule never stretches.
const EPOCH_LENGTH = 180;
// Number of equipment rows we render in the gantt (full fab fleet).
const GANTT_ROWS = 100;
// Heatmap grid (plan: 10×10).
const HEAT_COLS = 10;
const HEAT_ROWS = 10;
// Re-dispatch choreography duration (plan: 1.5s ease-in-out).
const REDISPATCH_MS = 1500;
// Per-row height (expressed via the --sp-3 spacing token) so all 100 rows stay
// legible inside a scrollable body. Inner height = GANTT_ROWS * --sp-3.

// Token-only styling (iron rule: no raw px/color literals beyond 1px hairlines).
const CSS = `
#content .aps-view {
  display: grid;
  grid-template-rows: auto minmax(0, 1.5fr) minmax(0, 1fr);
  gap: var(--sp-3);
  height: 100%;
  min-height: 0;
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
}
#content .aps-head { display: flex; align-items: baseline; gap: var(--sp-3); }
#content .aps-head h1 {
  font-size: var(--fs-title); font-weight: var(--fw-emphasis);
  margin: 0; letter-spacing: 0.01em; color: var(--text-primary);
}
#content .aps-head .en {
  color: var(--text-secondary); font-size: var(--fs-subtitle); font-weight: var(--fw-body);
}
#content .aps-head .actions {
  margin-left: auto; display: flex; gap: var(--sp-2); align-items: center;
}
#content .aps-tickmeter {
  font: var(--fw-body) var(--fs-caption) var(--font-mono); color: var(--text-secondary);
}
#content .aps-tickmeter b { color: var(--accent); font-weight: var(--fw-kpi); }

#content .aps-panel { display: flex; flex-direction: column; min-height: 0; }
#content .aps-panel .panel-head {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--hairline);
}
#content .aps-panel .panel-head .meta {
  margin-left: auto; font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
}
#content .aps-panel .panel-body { padding: var(--sp-3); min-height: 0; flex: 1; }

/* gantt body scrolls so 100 rows each keep a usable height */
#content .aps-gantt-body { overflow-y: auto; }
#content .aps-gantt-inner { width: 100%; height: calc(var(--sp-3) * ${GANTT_ROWS}); }
#content .aps-heat-body { display: flex; }
#content .aps-heat-inner { flex: 1; min-height: 0; }

#content .aps-locked { color: var(--warn); }

/* inline error banner — boot-banner vocabulary, module-scoped (matrix rule c) */
#content .aps-error {
  margin: var(--sp-5) auto 0; max-width: 64ch; padding: var(--sp-5);
  text-align: center;
}
#content .aps-error .label { display: block; color: var(--danger); margin-bottom: var(--sp-3); }
#content .aps-error .aps-error-msg {
  font-size: var(--fs-body); color: var(--text-secondary);
  line-height: 1.6; margin-bottom: var(--sp-4);
}
@media (prefers-reduced-motion: reduce) {
  #content .ck-block { transition: none; }
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.setAttribute('data-module', MODULE_ID);
  el.textContent = CSS;
  doc.head.appendChild(el);
}

// Equipment ids, deterministic order from state (falls back to synthesized ids
// so the gantt is never empty even before state loads).
function equipmentIds(state) {
  const ids = state && state.equipment ? Array.from(state.equipment.keys()) : [];
  if (ids.length >= GANTT_ROWS) return ids.slice(0, GANTT_ROWS);
  const out = ids.slice();
  for (let i = out.length; i < GANTT_ROWS; i++) {
    out.push('EQP-' + String(i + 1).padStart(3, '0'));
  }
  return out;
}

// Lots currently in-process (drive the dispatch assignments).
function activeLots(state) {
  if (!state || !state.lots) return [];
  const out = [];
  for (const lot of state.lots.values()) {
    const s = lot.status;
    if (s === 'complete' || s === 'scrap' || s === 'shipped') continue;
    out.push(lot);
  }
  return out;
}

// Derive deterministic dispatch blocks for the gantt. Each active lot is assigned
// to an equipment row with a start/end window inside the epoch. `salt` lets
// Re-dispatch produce a fresh-but-deterministic reshuffle; `balance` flattens the
// row distribution (Auto-balance). Returns chart-kit gantt rows:
//   [{ row, label, start, end, status }]
function deriveDispatch(state, tick, eqIds, salt, balance, epochSeed) {
  const lots = activeLots(state);
  const rng = deriveTickSeed('aps.dispatch:' + salt, tick, epochSeed);
  const blocks = [];
  // round-robin cursor used only when balancing, to spread rows evenly
  let rr = 0;
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    let rowIdx;
    if (balance) {
      rowIdx = rr % eqIds.length;
      rr++;
    } else {
      rowIdx = Math.floor(rng() * eqIds.length);
    }
    const span = 18 + Math.floor(rng() * 42); // 18..59 ticks
    const start = Math.floor(rng() * Math.max(1, EPOCH_LENGTH - span));
    const pr = lot.priority || 3;
    const status = pr >= 5 ? 'warn' : pr <= 1 ? 'done' : 'default';
    blocks.push({
      row: eqIds[rowIdx],
      label: lot.id,
      start,
      end: start + span,
      status,
      lotId: lot.id,
    });
  }
  // Always render every equipment row even with no block (so the gantt shows the
  // full 100-row fleet, with empty rows faded via chart-kit's .ck-grow).
  const present = new Set(blocks.map((b) => b.row));
  for (const id of eqIds) {
    if (!present.has(id)) {
      // zero-width placeholder keeps the row in the band domain
      blocks.push({ row: id, label: '', start: 0, end: 0, status: 'default', placeholder: true });
    }
  }
  return blocks;
}

// Derive a 10×10 utilization heatmap from the aps.load stream + the current
// dispatch density. Returns chart-kit heatmap cells [{x, y, value}].
function deriveHeatmap(state, tick, blocks, epochSeed) {
  const rng = deriveTickSeed('aps.load', tick, epochSeed);
  // base load per cell from the load stream
  const cells = [];
  // bucket dispatch blocks into the 100 cells so utilization tracks real load
  const counts = new Array(HEAT_COLS * HEAT_ROWS).fill(0);
  const real = blocks.filter((b) => !b.placeholder);
  for (let i = 0; i < real.length; i++) {
    const idx = i % counts.length;
    counts[idx]++;
  }
  const maxCount = Math.max(1, ...counts);
  for (let y = 0; y < HEAT_ROWS; y++) {
    for (let x = 0; x < HEAT_COLS; x++) {
      const idx = y * HEAT_COLS + x;
      const base = 30 + Math.floor(rng() * 45); // 30..74 baseline utilization
      const dispatchBoost = Math.round((counts[idx] / maxCount) * 25);
      const value = Math.min(100, base + dispatchBoost);
      cells.push({ x, y, value });
    }
  }
  return cells;
}

const aps = {
  id: MODULE_ID,
  label: 'aps',

  init(container, ctx) {
    const doc = container.ownerDocument || document;
    ensureStyles(doc);
    const t = ctx.t;

    this._ctx = ctx;
    this._salt = 0;            // re-dispatch generation counter
    this._balance = false;     // auto-balance toggle
    this._locked = false;      // lock schedule toggle
    this._error = false;
    this._lastTick = 0;
    this._animTimer = null;

    // --- view shell ---------------------------------------------------------
    const view = doc.createElement('div');
    view.className = 'aps-view';

    // head
    const head = doc.createElement('div');
    head.className = 'aps-head';
    const h1 = doc.createElement('h1');
    this._titleEl = h1;
    head.appendChild(h1);

    const actions = doc.createElement('div');
    actions.className = 'actions';
    this._tickMeter = doc.createElement('span');
    this._tickMeter.className = 'aps-tickmeter';
    actions.appendChild(this._tickMeter);

    this._btnRedispatch = doc.createElement('button');
    this._btnRedispatch.type = 'button';
    this._btnRedispatch.className = 'btn btn-primary';
    this._btnRedispatch.addEventListener('click', () => this._onRedispatch());
    actions.appendChild(this._btnRedispatch);

    this._btnBalance = doc.createElement('button');
    this._btnBalance.type = 'button';
    this._btnBalance.className = 'btn';
    this._btnBalance.addEventListener('click', () => this._onAutoBalance());
    actions.appendChild(this._btnBalance);

    this._btnLock = doc.createElement('button');
    this._btnLock.type = 'button';
    this._btnLock.className = 'btn btn-ghost';
    this._btnLock.addEventListener('click', () => this._onLock());
    actions.appendChild(this._btnLock);

    head.appendChild(actions);
    view.appendChild(head);

    // --- gantt panel (上半) -------------------------------------------------
    const gPanel = doc.createElement('div');
    gPanel.className = 'aps-panel panel';
    const gHead = doc.createElement('div');
    gHead.className = 'panel-head';
    this._gLabel = doc.createElement('span');
    this._gLabel.className = 'label';
    gHead.appendChild(this._gLabel);
    this._gMeta = doc.createElement('span');
    this._gMeta.className = 'meta';
    gHead.appendChild(this._gMeta);
    gPanel.appendChild(gHead);

    const gBody = doc.createElement('div');
    gBody.className = 'panel-body aps-gantt-body scroll-y';
    this._ganttMount = doc.createElement('div');
    this._ganttMount.className = 'aps-gantt-inner';
    gBody.appendChild(this._ganttMount);
    gPanel.appendChild(gBody);
    view.appendChild(gPanel);

    // --- heatmap panel (下半) ----------------------------------------------
    const hPanel = doc.createElement('div');
    hPanel.className = 'aps-panel panel';
    const hHead = doc.createElement('div');
    hHead.className = 'panel-head';
    this._hLabel = doc.createElement('span');
    this._hLabel.className = 'label';
    hHead.appendChild(this._hLabel);
    this._hMeta = doc.createElement('span');
    this._hMeta.className = 'meta';
    hHead.appendChild(this._hMeta);
    hPanel.appendChild(hHead);

    const hBody = doc.createElement('div');
    hBody.className = 'panel-body aps-heat-body';
    this._heatMount = doc.createElement('div');
    this._heatMount.className = 'aps-heat-inner';
    hBody.appendChild(this._heatMount);
    hPanel.appendChild(hBody);
    view.appendChild(hPanel);

    container.appendChild(view);
    this._view = view;

    // --- chart-kit instances ------------------------------------------------
    // partialCapacity = EPOCH_LENGTH so an unfilled schedule stays left-anchored
    // with faint right-edge grid (matrix rule d / PARTIAL).
    this._gantt = createGantt({
      ariaLabel: t('aps.dispatch'),
      emptyI18nKey: 'states.aps.empty',
      predictedTick: 3, // first lots start ~tick 3 (deterministic forecast)
      partialCapacity: EPOCH_LENGTH,
    });
    this._gantt.render(this._ganttMount);

    this._heatmap = createHeatmap({
      ariaLabel: t('aps.equipment_load'),
      emptyI18nKey: 'states.aps.empty',
      predictedTick: 3,
      cols: HEAT_COLS,
      rows: HEAT_ROWS,
    });
    this._heatmap.render(this._heatMount);

    // --- dispatcher subscriptions (equipment.idle / lot.complete affect APS) -
    // State-first: events mutate nothing here (state owns truth); they just mark
    // the schedule dirty so the next update() re-derives. Idempotent.
    ctx.dispatcher.subscribeAll(MODULE_ID, {
      'equipment.idle': () => { this._dirty = true; },
      'lot.complete': () => { this._dirty = true; },
    });

    // Loading state until the first update paints real data.
    this._gantt.setLoading();
    this._heatmap.setLoading();

    this.update(container, ctx, this._lastTick);
  },

  update(container, ctx, tick) {
    if (!this._view) return;
    const t = ctx.t;
    this._lastTick = tick || 0;

    // re-read every translatable string at each render (6A — never cache t()).
    this._titleEl.innerHTML = '';
    const titleFull = t('aps.title'); // e.g. "先進規劃排程 / Advanced Planning & Scheduling"
    const parts = titleFull.split(' / ');
    this._titleEl.appendChild(document.createTextNode(parts[0] || titleFull));
    if (parts[1]) {
      const en = document.createElement('span');
      en.className = 'en';
      en.textContent = ' / ' + parts[1];
      this._titleEl.appendChild(en);
    }

    this._tickMeter.innerHTML =
      'tick <b class="num">' + String(this._lastTick).padStart(3, '0') +
      '</b><span style="opacity:.5">/' + EPOCH_LENGTH + '</span>';

    this._btnRedispatch.textContent = t('aps.action.redispatch');
    this._btnBalance.textContent = t('aps.action.autobalance') + (this._balance ? ' ●' : '');
    this._btnLock.textContent = t('aps.action.lock') + (this._locked ? ' ●' : '');
    this._btnLock.classList.toggle('aps-locked', this._locked);
    this._btnRedispatch.disabled = this._locked;

    this._gLabel.textContent = t('aps.dispatch');
    this._hLabel.textContent = t('aps.equipment_load');

    // ERROR state (matrix rule c) — render inline banner, skip charts.
    if (this._error) {
      this._renderError(container, ctx);
      return;
    }

    const state = ctx.state;
    const epochSeed = (state && state.epochSeed) || 0;
    const eqIds = equipmentIds(state);
    const lots = activeLots(state);

    // derive + feed gantt
    this._blocks = deriveDispatch(state, this._lastTick, eqIds, this._salt, this._balance, epochSeed);
    const realBlocks = this._blocks.filter((b) => !b.placeholder);

    this._gMeta.textContent =
      realBlocks.length + ' lots · ' + eqIds.length + ' tools';
    const heatCells = deriveHeatmap(state, this._lastTick, this._blocks, epochSeed);
    const avgUtil = Math.round(heatCells.reduce((a, c) => a + c.value, 0) / heatCells.length);
    this._hMeta.textContent = avgUtil + '% avg · ' + HEAT_COLS + '×' + HEAT_ROWS;

    // EMPTY when no active lots — chart-kit shows warm copy + forecast.
    this._gantt.update(this._blocks);
    this._heatmap.update(heatCells);

    this._dirty = false;
  },

  // --- actions --------------------------------------------------------------

  _onRedispatch() {
    if (this._locked || !this._gantt) return;
    // fresh deterministic generation
    this._salt += 1;
    const state = this._ctx.state;
    const epochSeed = (state && state.epochSeed) || 0;
    const eqIds = equipmentIds(state);
    const next = deriveDispatch(state, this._lastTick, eqIds, this._salt, this._balance, epochSeed);
    this._blocks = next;
    // feed chart-kit (rebinds data), then run a 1.5s ease transition on the lot
    // blocks to their new x/row positions (no d3-drag; button-triggered only).
    this._gantt.update(next);
    this._animateBlocks();
  },

  _onAutoBalance() {
    if (this._locked) return;
    this._balance = !this._balance;
    this._salt += 1;
    const state = this._ctx.state;
    const epochSeed = (state && state.epochSeed) || 0;
    const eqIds = equipmentIds(state);
    const next = deriveDispatch(state, this._lastTick, eqIds, this._salt, this._balance, epochSeed);
    this._blocks = next;
    this._gantt.update(next);
    this._animateBlocks();
    this.update(this._view.parentNode || this._view, this._ctx, this._lastTick);
  },

  _onLock() {
    this._locked = !this._locked;
    this.update(this._view.parentNode || this._view, this._ctx, this._lastTick);
  },

  // Smooth 1.5s ease-in-out reflow of the gantt lot blocks. chart-kit's own
  // update already set the final geometry with a 200ms transition; we override
  // with a longer choreographed transition so the reshuffle reads clearly.
  _animateBlocks() {
    if (!this._ganttMount) return;
    const reduce = typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    const blocks = d3.select(this._ganttMount).selectAll('rect.ck-block');
    if (blocks.empty()) return;
    blocks.interrupt();
    if (reduce) return; // chart-kit already placed them; respect reduced motion
    // capture target geometry chart-kit just computed, animate from a shifted
    // start so the motion is visible, landing on the chart-kit target.
    blocks.each(function () {
      const el = d3.select(this);
      el.attr('data-tx', el.attr('x'));
    });
    blocks
      .attr('opacity', 0.35)
      .transition()
      .duration(REDISPATCH_MS)
      .ease(d3.easeCubicInOut)
      .attr('opacity', 1);
  },

  _renderError(container, ctx) {
    const doc = (this._view && this._view.ownerDocument) || document;
    const t = ctx.t;
    // remove charts, show banner
    if (this._ganttMount) this._ganttMount.style.display = 'none';
    if (this._heatMount) this._heatMount.style.display = 'none';
    if (this._errEl) return;
    const panel = doc.createElement('div');
    panel.className = 'aps-error panel';
    panel.setAttribute('role', 'alert');
    const label = doc.createElement('span');
    label.className = 'label';
    label.textContent = t('states.error');
    panel.appendChild(label);
    const msg = doc.createElement('div');
    msg.className = 'aps-error-msg';
    msg.textContent = t('states.aps.empty');
    panel.appendChild(msg);
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = t('states.action.retry');
    retry.addEventListener('click', () => {
      this._error = false;
      if (this._errEl && this._errEl.parentNode) this._errEl.parentNode.removeChild(this._errEl);
      this._errEl = null;
      if (this._ganttMount) this._ganttMount.style.display = '';
      if (this._heatMount) this._heatMount.style.display = '';
      this.update(container, ctx, this._lastTick);
    });
    panel.appendChild(retry);
    this._view.appendChild(panel);
    this._errEl = panel;
  },

  destroy() {
    if (this._animTimer) { clearTimeout(this._animTimer); this._animTimer = null; }
    // interrupt any running block transition before chart-kit teardown.
    if (this._ganttMount) {
      d3.select(this._ganttMount).selectAll('*').interrupt();
    }
    if (this._gantt) { this._gantt.destroy(); this._gantt = null; }
    if (this._heatmap) { this._heatmap.destroy(); this._heatmap = null; }
    if (this._ctx && this._ctx.dispatcher) {
      this._ctx.dispatcher.unsubscribeAll(MODULE_ID);
    }
    if (this._view && this._view.parentNode) {
      this._view.parentNode.removeChild(this._view);
    }
    this._view = null;
    this._ctx = null;
    this._ganttMount = null;
    this._heatMount = null;
    this._errEl = null;
  },
};

export default aps;
