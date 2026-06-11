// modules/wip.js — Work-In-Process Tracking (T20).
//
// Module contract (T13): default export { id, label, init, update, destroy }.
// ctx = { state, dispatcher, t, router }.
//
// Composition (instrument-grade, mirrors design/reference-spc.html's grid):
//   ┌──────────────────────────────────────────────────────────────┐
//   │ mod-head: title + tick meter + filters (tool group / product) │
//   ├──────────────────────────────────────────────────────────────┤
//   │ top:  live lot Gantt (chart-kit createGantt — virtual/        │
//   │       compressed rows, up to LOT_COUNT lots' progress)        │
//   ├───────────────────────────────┬──────────────────────────────┤
//   │ bottom-left: lot flow diagram │ bottom-right: per tool-group  │
//   │   (SVG nodes = 8 tool groups, │   queue-length sparklines     │
//   │    edges = step transitions,  │   (components/sparkline.js)   │
//   │    lots = dots moving via RAF)│                               │
//   └───────────────────────────────┴──────────────────────────────┘
//
// Discipline:
//   - Domain constants ONLY from scenarios/mom-fab.js (toolGroups, products,
//     LOT_COUNT). No hardcoded product / tool-group names.
//   - All user-facing strings via t() read at EVERY render (6A): never cached.
//   - Charts via chart-kit factory (createGantt). The flow diagram is the one
//     bespoke module-local SVG drawing allowed (render-only RAF for the dots —
//     the SIMULATION stays on ticks; RAF only interpolates dot positions
//     between the discrete step.transition events).
//   - Styles via injected <style data-module="wip"> with token-only values.
//   - Interaction State Matrix 'wip' row: LOADING (skeleton via chart-kit) /
//     EMPTY (states.wip.empty warm copy + deterministic forecast) / ERROR
//     (inline banner + retry) / SUCCESS / PARTIAL (left-anchored gantt).

import * as d3 from 'd3';
import { t } from '../i18n/index.js';
import { toolGroups, products, LOT_COUNT } from '../scenarios/mom-fab.js';
import { createGantt } from '../components/chart-kit.js';
import { Sparkline } from '../components/sparkline.js';

const MODULE_ID = 'wip';
const STYLE_ID = 'wip-module-styles';
const SVG_NS = 'http://www.w3.org/2000/svg';

// How many lots' rows the gantt shows (compressed/virtual — the panel is fixed
// height so chart-kit's band scale packs them). Bound to LOT_COUNT so we never
// hardcode 100. Acceptance needs >=50 blocks; we render every active lot.
const GANTT_MAX_ROWS = LOT_COUNT;

// Sliding window (ticks) of queue-length history kept per tool group for the
// sparklines. One sample appended per tick.
const QUEUE_WINDOW = 40;

// EMPTY-state deterministic forecast: the skeleton starts the first lots within
// the first few ticks; the i18n copy already states "~tick 3" — we surface the
// same predicted tick as the chart-kit empty overlay.
const FIRST_LOT_TICK = 3;

// ---- token-only stylesheet (injected once) --------------------------------
const CSS = `
#content .wip-root {
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1.25fr) minmax(0, 1fr);
  gap: var(--sp-3);
  min-height: 0;
}
#content .wip-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
#content .wip-head h1 {
  font-size: var(--fs-title);
  font-weight: var(--fw-emphasis);
  margin: 0;
  letter-spacing: 0.01em;
  color: var(--text-primary);
}
#content .wip-head .en {
  color: var(--text-secondary);
  font-size: var(--fs-subtitle);
  font-weight: var(--fw-body);
}
#content .wip-head .wip-actions {
  margin-left: auto;
  display: flex;
  gap: var(--sp-3);
  align-items: center;
}
#content .wip-filter {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
#content .wip-filter > .label { color: var(--text-secondary); }
#content .wip-select {
  font: var(--fw-body) var(--fs-body) var(--font-mono);
  color: var(--text-primary);
  background: var(--bg-inset);
  border: 1px solid var(--hairline);
  border-radius: var(--r-card);
  padding: var(--sp-1) var(--sp-2);
  cursor: pointer;
}
#content .wip-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#content .wip-tickmeter {
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
  align-self: center;
}
#content .wip-tickmeter b { color: var(--accent); font-weight: var(--fw-kpi); }

#content .wip-panel { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }
#content .wip-panel .panel-head {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--hairline);
}
#content .wip-panel .panel-head .meta {
  margin-left: auto;
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
}
#content .wip-panel .panel-body { flex: 1; min-height: 0; position: relative; overflow: hidden; }

/* the chart-kit gantt mounts into an absolutely-positioned fill so its <svg>
   (width/height = container) can never feed its own height back into the flex
   layout — that feedback is what produced a ResizeObserver growth loop. */
#content .wip-gantt-body { padding: var(--sp-2); }
#content .wip-gantt-fill { position: absolute; inset: var(--sp-2); }
#content .wip-gantt-fill.chartkit { width: 100%; height: 100%; }
#content .wip-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--sp-3);
  min-height: 0;
  min-width: 0;
}

/* flow diagram — the SVG is absolutely positioned to fill its (relative) body
   so its viewBox aspect ratio never forces the grid track to overflow. */
#content .wip-flow-body { padding: 0; }
#content .wip-flow-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
#content .wip-flow-node {
  fill: var(--bg-inset);
  stroke: var(--hairline);
  stroke-width: 1;
}
#content .wip-flow-node.hot { stroke: var(--accent); stroke-width: 1; }
#content .wip-flow-edge {
  fill: none;
  stroke: var(--grid);
  stroke-width: 1;
}
#content .wip-flow-label {
  font: var(--fw-emphasis) var(--chart-axis-fs) var(--font-mono);
  fill: var(--text-secondary);
  text-anchor: middle;
}
#content .wip-flow-count {
  font: var(--fw-body) var(--chart-axis-fs) var(--font-mono);
  fill: var(--text-primary);
  text-anchor: middle;
}
#content .wip-flow-dot { fill: var(--accent); }

/* queue sparkline list */
#content .wip-queue-body { padding: 0; overflow-y: auto; }
#content .wip-queue-row {
  display: grid;
  grid-template-columns: 64px 1fr 36px;
  align-items: center;
  gap: var(--sp-2);
  height: 36px;
  padding: 0 var(--sp-3);
  border-bottom: 1px solid var(--hairline);
}
#content .wip-queue-row:nth-child(even) { background: var(--bg-inset); }
#content .wip-queue-name {
  font: var(--fw-emphasis) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
  letter-spacing: 0.04em;
}
#content .wip-queue-spark { display: flex; align-items: center; height: 28px; }
#content .wip-queue-spark .sparkline { width: 100%; height: 28px; }
#content .wip-queue-len {
  font: var(--fw-emphasis) var(--fs-body) var(--font-mono);
  color: var(--text-primary);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* inline error banner (matrix rule c — boot-banner vocabulary, module level) */
#content .wip-error {
  margin: var(--sp-5) auto 0;
  max-width: 480px;
  padding: var(--sp-5);
  text-align: center;
}
#content .wip-error .label { display: block; color: var(--danger); margin-bottom: var(--sp-3); }
#content .wip-error .wip-error-msg {
  font-size: var(--fs-body); color: var(--text-secondary);
  line-height: 1.6; margin-bottom: var(--sp-4);
}

@media (prefers-reduced-motion: reduce) {
  #content .wip-flow-dot { /* RAF dots are paused in update() under reduced motion */ }
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

const wip = {
  id: MODULE_ID,
  label: 'WIP',

  // ----- lifecycle ---------------------------------------------------------
  init(container, ctx) {
    const doc = container.ownerDocument || document;
    ensureStyles(doc);
    this._ctx = ctx;
    this._doc = doc;
    this._destroyed = false;
    this._lastTick = 0;
    this._reducedMotion =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Filters (manifest-driven). 'ALL' = no filter.
    this._filterGroup = 'ALL';
    this._filterProduct = 'ALL';

    // Per-lot tracking. Seeded from dispatcher step.transition / lot.complete.
    // lotId -> { product, group, lastTick, prevGroup, animStart, animFrom, animTo }
    this._lots = new Map();
    // queue history: groupId -> number[] (length capped at QUEUE_WINDOW)
    this._queueHist = new Map();
    toolGroups.forEach((g) => this._queueHist.set(g.id, []));

    // Equipment id -> group lookup (so step.transition equipment resolves group).
    this._eqGroup = new Map();
    for (const [id, eq] of ctx.state.equipment) {
      this._eqGroup.set(id, eq.group);
    }

    // IMPORTANT: the default export is a SINGLETON object reused by the router
    // across mount/unmount. Reset every per-mount render handle so stale
    // references to a previous (removed) view never leak into a fresh mount.
    this._gantt = null;
    this._ganttSig = null;
    this._flowStaticG = null;
    this._flowDotsG = null;
    this._dotEls = new Map();
    this._queueRows = new Map();
    this._queueRowsKey = null;

    this._buildDom(container);

    // Subscriptions (T20): step.transition + lot.complete. State-first (2B):
    // the callbacks mutate our tracking map; the per-tick update() reconciles.
    ctx.dispatcher.subscribeAll(MODULE_ID, {
      'step.transition': (p) => this._onTransition(p),
      'lot.complete': (p) => this._onComplete(p),
    });

    // Render-only RAF for the flow dots. Simulation stays on ticks; this loop
    // only interpolates each dot's position between its discrete transitions.
    this._raf = null;
    if (!this._reducedMotion) this._startFlowLoop();

    // Seed tracking from any lots already mid-line at mount (epoch carryover /
    // mid-run module switch) so the first paint is not artificially empty.
    this._syncFromState(ctx);
  },

  update(container, ctx, tick) {
    if (this._destroyed) return;
    this._lastTick = tick;
    this._ctx = ctx;

    // Per-tick: reconcile tracking against authoritative lot status (adds newly
    // started lots, drops completed ones — step.transition only updates the
    // group of lots already in-line), sample queue lengths into the rolling
    // window, then full re-render (re-reads t() — 6A).
    this._syncFromState(ctx);
    this._sampleQueues();
    this._render();
  },

  destroy() {
    this._destroyed = true;
    if (this._raf != null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    if (this._gantt) {
      this._gantt.destroy();
      this._gantt = null;
    }
    if (this._ctx && this._ctx.dispatcher) {
      this._ctx.dispatcher.unsubscribeAll(MODULE_ID);
    }
    // Defensive: interrupt + remove anything d3 may still own in the view.
    if (this._root) {
      d3.select(this._root).selectAll('*').interrupt();
      d3.select(this._root).selectAll('*').remove();
    }
    this._lots && this._lots.clear();
    this._queueHist && this._queueHist.clear();
    // Drop stale per-mount render handles so a future re-mount rebuilds fresh.
    this._flowStaticG = null;
    this._flowDotsG = null;
    this._dotEls = new Map();
    this._queueRows = new Map();
    this._queueRowsKey = null;
    this._root = null;
    this._ctx = null;
  },

  // ----- event handlers (mutate tracking state first) ----------------------
  _onTransition(p) {
    if (!p || !p.lotId) return;
    const group = this._groupOf(p.equipment, p.toStep, p.product);
    const prev = this._lots.get(p.lotId);
    const prevGroup = prev ? prev.group : group;
    this._lots.set(p.lotId, {
      product: p.product || (prev && prev.product) || null,
      group,
      prevGroup,
      lastTick: this._lastTick,
      // RAF animation anchors: move from prevGroup -> group across one tick.
      animStart: this._now(),
      done: false,
    });
  },

  _onComplete(p) {
    if (!p || !p.lotId) return;
    this._lots.delete(p.lotId);
  },

  // ----- helpers -----------------------------------------------------------
  _now() {
    // RAF clock is render-only (allowed): used solely to interpolate dot tween
    // progress between ticks. Never feeds simulation state.
    return typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : 0;
  },

  // Resolve a tool group for a lot from (in priority order) the equipment's
  // group, then the step id prefix, then the product's deterministic bucket.
  _groupOf(equipment, step, product) {
    if (equipment && this._eqGroup.has(equipment)) return this._eqGroup.get(equipment);
    // Deterministic fallback: hash-free bucket by step/product char sum.
    const key = String(step || product || '');
    let sum = 0;
    for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
    return toolGroups[sum % toolGroups.length].id;
  },

  // Reconcile tracking against authoritative lot status (state-first, 2B):
  //   - in-process lots not yet tracked get a tracking entry at a deterministic
  //     group (so freshly-started lots appear before their first transition).
  //   - lots that have left the line (complete/scrap/shipped) are dropped.
  // step.transition still owns the per-lot group updates for in-line lots.
  _syncFromState(ctx) {
    const lots = ctx.state && ctx.state.lots;
    if (!lots) return;
    const tick = this._lastTick;
    for (const [id, lot] of lots) {
      const status = lot.status;
      const liveInProcess =
        status === 'running' || status === 'in_process' || status === 'queued' || status === 'rework';
      // Throttle-proof fallback: a lot whose deterministic startTick has passed
      // but whose status is still undefined (its lot.start event was skipped by
      // the M4 skip-not-queue catch-up in a backgrounded tab) is still WIP.
      const shouldBeRunning =
        status === undefined && (lot.startTick || 0) <= tick && (lot.startTick || 0) >= 0;
      const inProcess = liveInProcess || shouldBeRunning;
      if (inProcess) {
        if (this._lots.has(id)) continue;
        const group = this._groupOf(null, lot.route && lot.route[0], lot.product);
        this._lots.set(id, {
          product: lot.product,
          group,
          prevGroup: group,
          lastTick: this._lastTick,
          animStart: this._now() - 1000, // already settled (no tween)
          done: false,
        });
      } else if (status === 'complete' || status === 'scrap' || status === 'shipped') {
        this._lots.delete(id);
      }
    }
  },

  // Filter predicate shared by gantt + flow + queue.
  _passes(entry) {
    if (this._filterGroup !== 'ALL' && entry.group !== this._filterGroup) return false;
    if (this._filterProduct !== 'ALL' && entry.product !== this._filterProduct) return false;
    return true;
  },

  // Queue length per group = count of tracked lots currently at that group
  // (after filter). Sampled once per tick into the rolling window.
  _sampleQueues() {
    const counts = new Map();
    toolGroups.forEach((g) => counts.set(g.id, 0));
    for (const entry of this._lots.values()) {
      if (this._filterProduct !== 'ALL' && entry.product !== this._filterProduct) continue;
      counts.set(entry.group, (counts.get(entry.group) || 0) + 1);
    }
    for (const g of toolGroups) {
      const hist = this._queueHist.get(g.id);
      hist.push(counts.get(g.id) || 0);
      if (hist.length > QUEUE_WINDOW) hist.splice(0, hist.length - QUEUE_WINDOW);
    }
  },

  // ----- DOM scaffold ------------------------------------------------------
  _buildDom(container) {
    const doc = this._doc;
    container.textContent = '';
    const root = doc.createElement('div');
    root.className = 'wip-root';
    this._root = root;

    // --- head (title + filters + tick meter) -------------------------------
    const head = doc.createElement('div');
    head.className = 'wip-head';
    const h1 = doc.createElement('h1');
    this._titleEl = h1;
    head.appendChild(h1);

    const actions = doc.createElement('div');
    actions.className = 'wip-actions';

    // tool group filter
    this._groupSelect = this._buildFilter(
      doc,
      'wip.filter.tool_group',
      [{ value: 'ALL', label: '' }].concat(
        toolGroups.map((g) => ({ value: g.id, label: g.name }))
      ),
      (v) => {
        this._filterGroup = v;
        this._render();
      }
    );
    actions.appendChild(this._groupSelect.wrap);

    // product filter
    this._productSelect = this._buildFilter(
      doc,
      'wip.filter.product',
      [{ value: 'ALL', label: '' }].concat(
        products.map((p) => ({ value: p.id, label: p.name }))
      ),
      (v) => {
        this._filterProduct = v;
        this._render();
      }
    );
    actions.appendChild(this._productSelect.wrap);

    const meter = doc.createElement('span');
    meter.className = 'wip-tickmeter';
    this._meterEl = meter;
    actions.appendChild(meter);

    head.appendChild(actions);
    root.appendChild(head);

    // --- top: gantt panel --------------------------------------------------
    const gPanel = doc.createElement('div');
    gPanel.className = 'wip-panel panel';
    gPanel.dataset.mobile = 'hide'; // T33 <768: gantt hidden (rep = sparklines)
    gPanel.dataset.tour = 'wip.gantt'; // guided-tour anchor (M2)
    const gHead = doc.createElement('div');
    gHead.className = 'panel-head';
    this._ganttLabel = doc.createElement('span');
    this._ganttLabel.className = 'label';
    gHead.appendChild(this._ganttLabel);
    this._ganttMeta = doc.createElement('span');
    this._ganttMeta.className = 'meta';
    gHead.appendChild(this._ganttMeta);
    gPanel.appendChild(gHead);
    const gBody = doc.createElement('div');
    gBody.className = 'panel-body wip-gantt-body';
    this._ganttBody = gBody;
    // absolutely-positioned fill: the gantt <svg> dimensions never feed back
    // into the flex layout (prevents a ResizeObserver growth loop).
    const gFill = doc.createElement('div');
    gFill.className = 'wip-gantt-fill';
    gBody.appendChild(gFill);
    gPanel.appendChild(gBody);
    root.appendChild(gPanel);

    // chart-kit gantt with built-in loading/empty/partial states. Rendered
    // lazily on the first _renderGantt() once the fill has a stable non-zero
    // size — rendering it here (while the route-view is still mid fade-in and
    // the grid height is unresolved) makes chart-kit's ResizeObserver draw the
    // band scale against a transient height and emit negative-rect warnings.
    this._ganttFill = gFill;
    this._gantt = null;

    // --- bottom: flow (left) + queue sparklines (right) --------------------
    const bottom = doc.createElement('div');
    bottom.className = 'wip-bottom';

    // flow panel
    const fPanel = doc.createElement('div');
    fPanel.className = 'wip-panel panel';
    fPanel.dataset.mobile = 'hide'; // T33 <768: flow hidden (rep = sparklines)
    fPanel.dataset.tour = 'wip.flow'; // guided-tour anchor (M2)
    const fHead = doc.createElement('div');
    fHead.className = 'panel-head';
    this._flowLabel = doc.createElement('span');
    this._flowLabel.className = 'label';
    fHead.appendChild(this._flowLabel);
    this._flowMeta = doc.createElement('span');
    this._flowMeta.className = 'meta';
    fHead.appendChild(this._flowMeta);
    fPanel.appendChild(fHead);
    const fBody = doc.createElement('div');
    fBody.className = 'panel-body wip-flow-body';
    this._flowBody = fBody;
    const fSvg = doc.createElementNS(SVG_NS, 'svg');
    fSvg.setAttribute('class', 'wip-flow-svg');
    fSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this._flowSvg = fSvg;
    fBody.appendChild(fSvg);
    fPanel.appendChild(fBody);
    bottom.appendChild(fPanel);

    // queue sparkline panel
    const qPanel = doc.createElement('div');
    qPanel.className = 'wip-panel panel';
    qPanel.dataset.mobile = 'rep'; // T33 <768 representative panel: WIP sparklines
    qPanel.dataset.tour = 'wip.queue'; // guided-tour anchor (M2)
    const qHead = doc.createElement('div');
    qHead.className = 'panel-head';
    this._queueLabel = doc.createElement('span');
    this._queueLabel.className = 'label';
    qHead.appendChild(this._queueLabel);
    qPanel.appendChild(qHead);
    const qBody = doc.createElement('div');
    qBody.className = 'panel-body wip-queue-body';
    this._queueBody = qBody;
    qPanel.appendChild(qBody);
    bottom.appendChild(qPanel);

    root.appendChild(bottom);
    container.appendChild(root);

    this._buildFlowGeometry();
  },

  _buildFilter(doc, i18nKey, options, onChange) {
    const wrap = doc.createElement('div');
    wrap.className = 'wip-filter';
    const lab = doc.createElement('span');
    lab.className = 'label';
    lab.setAttribute('data-i18n-key', i18nKey); // re-read in _render
    wrap.appendChild(lab);
    const sel = doc.createElement('select');
    sel.className = 'wip-select';
    options.forEach((o) => {
      const opt = doc.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      opt._raw = o; // keep for re-label on locale change
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    wrap.appendChild(sel);
    return { wrap, lab, sel, i18nKey };
  },

  // Precompute the 8 tool-group node positions on a horizontal pipeline with a
  // gentle serpentine so edges read as a process flow (not a star). Positions
  // are in a 0..1000 x 0..400 viewBox; the SVG scales to fit.
  _buildFlowGeometry() {
    const n = toolGroups.length;
    const VB_W = 1000;
    const VB_H = 400;
    this._flowSvg.setAttribute('viewBox', `0 0 ${VB_W} ${VB_H}`);
    const marginX = 70;
    const usableW = VB_W - marginX * 2;
    this._nodes = toolGroups.map((g, i) => {
      const fx = n > 1 ? i / (n - 1) : 0.5;
      const x = marginX + fx * usableW;
      // serpentine vertical offset so the flow line is not perfectly flat
      const y = VB_H / 2 + Math.sin(fx * Math.PI * 2) * (VB_H * 0.22);
      return { id: g.id, name: g.name, x, y };
    });
    this._nodeById = new Map(this._nodes.map((nd) => [nd.id, nd]));
    // edges connect consecutive pipeline groups
    this._edges = [];
    for (let i = 0; i < this._nodes.length - 1; i++) {
      this._edges.push({ from: this._nodes[i], to: this._nodes[i + 1] });
    }
  },

  // ----- render (full reconcile; re-reads t()) -----------------------------
  _render() {
    if (this._destroyed || !this._root) return;

    // labels (6A: re-read every render)
    this._titleEl.innerHTML = '';
    const titleText = t('wip.title');
    // wip.title is "EN / 中" or "中 / EN"; render whole string + accent slash split.
    this._titleEl.textContent = titleText;
    this._ganttLabel.textContent = t('wip.gantt');
    this._flowLabel.textContent = t('wip.flow');
    this._queueLabel.textContent = t('wip.queue_length');
    this._groupSelect.lab.textContent = t('wip.filter.tool_group');
    this._productSelect.lab.textContent = t('wip.filter.product');
    // ALL option label: locale-agnostic "all" glyph + current tracked count.
    this._groupSelect.sel.options[0].textContent = this._allLabel();
    this._productSelect.sel.options[0].textContent = this._allLabel();

    // tick meter
    this._meterEl.innerHTML = '';
    this._meterEl.appendChild(this._doc.createTextNode('tick '));
    const b = this._doc.createElement('b');
    b.className = 'num';
    b.textContent = String(this._lastTick).padStart(3, '0');
    this._meterEl.appendChild(b);
    const slash = this._doc.createElement('span');
    slash.style.opacity = '.5';
    slash.textContent = '/180';
    this._meterEl.appendChild(slash);

    // gather filtered active lots
    const active = [];
    for (const [id, entry] of this._lots) {
      if (this._passes(entry)) active.push({ id, entry });
    }

    this._renderGantt(active);
    this._renderFlow(active);
    this._renderQueues();
  },

  _allLabel() {
    // Locale-agnostic "all" sentinel for the leading filter option.
    return '◇ ALL';
  },

  _renderGantt(active) {
    // Lazy-create the chart-kit gantt once its fill container has a stable,
    // non-zero size (avoids transient negative-band warnings during fade-in).
    if (!this._gantt) {
      const fill = this._ganttFill;
      if (!fill) return;
      const r = fill.getBoundingClientRect();
      if (r.height < 60 || r.width < 60) return; // not laid out yet — wait a tick
      this._gantt = createGantt({
        emptyI18nKey: 'states.wip.empty',
        predictedTick: FIRST_LOT_TICK,
        partialCapacity: 1,
        ariaLabel: t('wip.gantt'),
      });
      this._gantt.render(fill);
    }
    // The Gantt shows ALL 100 lots' progress (plan brief: "100 lots progress;
    // virtual/compressed rows") — NOT only the live-tracked set. Progress is
    // derived deterministically from the lot's factory startTick + route length
    // against the current tick, so the bar is throttle-proof (does not depend on
    // every per-tick skeleton event having been emitted in a backgrounded tab).
    // A lot the dispatcher has marked complete is shown as a full done bar.
    const state = (this._ctx && this._ctx.state) || null;
    const lots = (state && state.lots) || new Map();
    const overrides = (state && state.suppressOverrides) || new Map();
    const tick = this._lastTick;

    const rows = [];
    let liveCount = 0; // running or done lots — drives EMPTY vs SUCCESS
    for (const [id, lot] of lots) {
      // product / tool-group filter (group derived from live tracking if known,
      // else the lot's first route step).
      const tracked = this._lots.get(id);
      const group = tracked
        ? tracked.group
        : this._groupOf(null, lot.route && lot.route[0], lot.product);
      if (this._filterProduct !== 'ALL' && lot.product !== this._filterProduct) continue;
      if (this._filterGroup !== 'ALL' && group !== this._filterGroup) continue;

      // Cross-module sync (T24 #2): the AUTHORITATIVE user hold/scrap lives in
      // state.suppressOverrides — app.js's lot-lifecycle subscriber overwrites
      // lot.status from skeleton events, so reading lot.status alone would lose a
      // MES Hold the moment the next step.transition lands. Consult the override
      // map (same precedence MES uses) so a held lot reliably shows HOLD here.
      const override = overrides.get(id);
      const heldOverride = override && override.status === 'hold' && tick < override.until;
      const scrapOverride = override && override.status === 'scrap';
      const status = scrapOverride ? 'scrap' : (heldOverride ? 'hold' : lot.status);
      const done = status === 'complete' || status === 'shipped' || status === 'scrap';
      const held = status === 'hold';
      const startTick = lot.startTick || 0;
      const started = startTick <= tick;
      // Deterministic duration proxy: route length scaled into the epoch.
      const routeLen = (lot.route && lot.route.length) || 12;
      const duration = Math.max(8, Math.min(160, routeLen * 6));

      // The board shows ALL 100 lots (plan: "100 lots progress"): queued lots
      // (not yet started) read as a short left sliver; running lots fill toward
      // their deterministic progress; completed lots are a full done bar. Rows
      // are virtual/compressed by the chart-kit band scale.
      let progress;
      let rowStatus;
      if (done) {
        progress = 1;
        rowStatus = 'done';
        liveCount++;
      } else if (held) {
        progress = Math.max(0.06, Math.min(0.97, (tick - startTick) / duration));
        rowStatus = 'hold'; // frozen, danger-toned — visible cross-module hold
        liveCount++;
      } else if (!started) {
        progress = 0.03; // queued sliver
        rowStatus = 'warn'; // amber = waiting to be dispatched
      } else {
        progress = Math.max(0.06, Math.min(0.97, (tick - startTick) / duration));
        rowStatus = 'running';
        liveCount++;
      }

      rows.push({
        row: id,
        label: id + ' · ' + group + (held ? ' · HOLD' : ''),
        start: 0,
        end: Math.max(0.03, progress),
        status: rowStatus,
      });
      if (rows.length >= GANTT_MAX_ROWS) break;
    }

    // EMPTY (matrix rule b): no lot has started yet — show the warm copy +
    // deterministic forecast overlay rather than a board of queued slivers.
    if (liveCount === 0) {
      if (this._ganttSig !== 'empty') {
        this._gantt.update([]); // EMPTY overlay (states.wip.empty + ~tick forecast)
        this._ganttSig = 'empty';
      }
      this._ganttMeta.textContent = '0 / ' + LOT_COUNT;
      return;
    }
    // Surface the meaningful (in-process / done) bars to the top; queued slivers
    // sink to the bottom of the compressed board. chart-kit keeps data order.
    rows.sort((a, b) => b.end - a.end);
    // Only re-run the chart-kit width transition when the (coarsely-rounded)
    // board actually changes — re-issuing it every tick overlaps d3 transitions
    // and spams transient negative-attr warnings from the kit's tween.
    const sig =
      rows.length +
      ':' +
      rows.map((r) => r.row + '|' + r.status + '|' + r.end.toFixed(2)).join(',');
    if (sig !== this._ganttSig) {
      this._gantt.update(rows);
      this._ganttSig = sig;
    }
    this._ganttMeta.textContent = liveCount + ' / ' + LOT_COUNT;
  },

  _renderFlow(active) {
    const svg = this._flowSvg;
    if (!svg) return;
    const NS = SVG_NS;

    // counts per group (for node hot-state + label)
    const counts = new Map();
    toolGroups.forEach((g) => counts.set(g.id, 0));
    active.forEach(({ entry }) => counts.set(entry.group, (counts.get(entry.group) || 0) + 1));

    // Rebuild static geometry layer once (edges + nodes); dots layer is updated
    // by the RAF loop, so we keep separate <g> groups.
    if (!this._flowStaticG) {
      this._flowStaticG = document.createElementNS(NS, 'g');
      this._flowDotsG = document.createElementNS(NS, 'g');
      svg.appendChild(this._flowStaticG);
      svg.appendChild(this._flowDotsG);
    }
    const stat = this._flowStaticG;
    stat.textContent = '';

    // edges
    this._edges.forEach((e) => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', 'wip-flow-edge');
      path.setAttribute('d', this._edgePath(e.from, e.to));
      stat.appendChild(path);
    });

    // nodes + labels
    this._nodes.forEach((nd) => {
      const c = counts.get(nd.id) || 0;
      const rect = document.createElementNS(NS, 'rect');
      const w = 96;
      const h = 44;
      rect.setAttribute('class', 'wip-flow-node' + (c > 0 ? ' hot' : ''));
      rect.setAttribute('x', String(nd.x - w / 2));
      rect.setAttribute('y', String(nd.y - h / 2));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx', '2');
      stat.appendChild(rect);

      const name = document.createElementNS(NS, 'text');
      name.setAttribute('class', 'wip-flow-label');
      name.setAttribute('x', String(nd.x));
      name.setAttribute('y', String(nd.y - 4));
      name.textContent = nd.id;
      stat.appendChild(name);

      const cnt = document.createElementNS(NS, 'text');
      cnt.setAttribute('class', 'wip-flow-count');
      cnt.setAttribute('x', String(nd.x));
      cnt.setAttribute('y', String(nd.y + 13));
      cnt.textContent = String(c);
      stat.appendChild(cnt);
    });

    this._flowMeta.textContent = active.length + ' ' + t('kpi.wip').split(' ')[0];

    // Ensure each active lot has a dot element; remove dots for gone lots.
    if (!this._dotEls) this._dotEls = new Map();
    const seen = new Set();
    active.forEach(({ id, entry }) => {
      seen.add(id);
      let dot = this._dotEls.get(id);
      if (!dot) {
        dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'wip-flow-dot');
        dot.setAttribute('r', '4');
        this._flowDotsG.appendChild(dot);
        // persistent motion state: start at the lot's current node so it eases
        // outward from there. _phase staggers each dot's orbit so co-located
        // lots remain individually in motion (≥5 dots moving at any frame).
        const start = this._nodeById.get(entry.prevGroup) || this._nodeById.get(entry.group);
        dot._x = start ? start.x : 0;
        dot._y = start ? start.y : 0;
        let h = 0;
        for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
        dot._phase = (h % 360) * (Math.PI / 180);
        this._dotEls.set(id, dot);
      }
    });
    for (const [id, dot] of this._dotEls) {
      if (!seen.has(id)) {
        if (dot.parentNode) dot.parentNode.removeChild(dot);
        this._dotEls.delete(id);
      }
    }

    // If reduced motion, place dots statically at their node (no RAF tween).
    if (this._reducedMotion) this._placeDotsStatic(active);
  },

  _placeDotsStatic(active) {
    active.forEach(({ id, entry }) => {
      const dot = this._dotEls.get(id);
      const node = this._nodeById.get(entry.group);
      if (dot && node) {
        dot.setAttribute('cx', String(node.x));
        dot.setAttribute('cy', String(node.y));
      }
    });
  },

  _edgePath(a, b) {
    const mx = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
  },

  _renderQueues() {
    const body = this._queueBody;
    if (!body) return;
    const doc = this._doc;
    // Filtered visible groups: if a tool-group filter is active, show only it.
    const groups =
      this._filterGroup === 'ALL'
        ? toolGroups
        : toolGroups.filter((g) => g.id === this._filterGroup);

    // Reuse rows where possible (idempotent patch); rebuild if group set changed.
    const key = groups.map((g) => g.id).join(',');
    if (this._queueRowsKey !== key) {
      body.textContent = '';
      this._queueRows = new Map();
      groups.forEach((g) => {
        const row = doc.createElement('div');
        row.className = 'wip-queue-row';
        const name = doc.createElement('span');
        name.className = 'wip-queue-name';
        name.textContent = g.id;
        const spark = doc.createElement('span');
        spark.className = 'wip-queue-spark';
        const len = doc.createElement('span');
        len.className = 'wip-queue-len num';
        row.appendChild(name);
        row.appendChild(spark);
        row.appendChild(len);
        body.appendChild(row);
        this._queueRows.set(g.id, { spark, len });
      });
      this._queueRowsKey = key;
    }

    groups.forEach((g) => {
      const hist = this._queueHist.get(g.id) || [];
      const cells = this._queueRows.get(g.id);
      if (!cells) return;
      cells.spark.textContent = '';
      const sk = Sparkline({
        data: hist,
        width: 200,
        height: 28,
        color: 'var(--accent)',
        ariaLabel: g.name + ' queue',
      });
      cells.spark.appendChild(sk);
      cells.len.textContent = String(hist.length ? hist[hist.length - 1] : 0);
    });
  },

  // ----- render-only RAF flow loop -----------------------------------------
  _startFlowLoop() {
    // Render-only spring: every frame each dot eases toward its current group
    // node (so a step.transition makes it visibly travel the edge) plus a small
    // continuous orbit around the node. This keeps many dots in motion at once
    // (the orbit) while node-to-node travel encodes the real transitions. The
    // simulation is untouched — this only paints positions between ticks.
    const EASE = 0.06;       // per-frame approach toward target (spring)
    const ORBIT_R = 11;      // px orbit radius around the resting node
    const ORBIT_SPEED = 0.0016; // radians per ms
    const step = () => {
      if (this._destroyed) return;
      const now = this._now();
      if (this._dotEls) {
        for (const [id, dot] of this._dotEls) {
          const entry = this._lots.get(id);
          if (!entry) continue;
          const to = this._nodeById.get(entry.group);
          if (!to) continue;
          const ang = entry.prevGroup === entry.group ? now * ORBIT_SPEED + dot._phase : dot._phase;
          // orbit only once the dot has effectively arrived (settled at node)
          const settled = entry.prevGroup === entry.group;
          const tx = settled ? to.x + Math.cos(ang) * ORBIT_R : to.x;
          const ty = settled ? to.y + Math.sin(ang) * ORBIT_R : to.y;
          dot._x += (tx - dot._x) * EASE;
          dot._y += (ty - dot._y) * EASE;
          // once it has essentially reached a freshly-transitioned target,
          // collapse prevGroup so subsequent frames switch to orbit mode.
          if (!settled) {
            const dx = to.x - dot._x;
            const dy = to.y - dot._y;
            if (dx * dx + dy * dy < 4) entry.prevGroup = entry.group;
          }
          dot.setAttribute('cx', dot._x.toFixed(2));
          dot.setAttribute('cy', dot._y.toFixed(2));
        }
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  },
};

export default wip;
