// modules/yield.js — Yield / Defect module (T23).
// Module contract (T13): export default { id, label, init, update, destroy }.
//   ctx = { state, dispatcher, t, router }.
//
// Composition (instrument-grade, mirrors design/reference-spc.html panel grid):
//   ┌──────────────────────────────────────────────────────────────┐
//   │ Pareto (chart-kit createBarChart — defect types × count)      │  top, full width
//   ├───────────────────────────────────┬──────────────────────────┤
//   │ Wafer Map (module-local CANVAS,    │ Yield Trend (chart-kit    │
//   │ 300mm ring + notch, density dots)  │ createLineChart, 50 lots) │  bottom
//   └───────────────────────────────────┴──────────────────────────┘
//
// Owns the defect data stream (the engine skeleton only emits lot lifecycle):
//   each NEW tick → deriveTickSeed("defect.xy", tick) → deterministic defect
//   batch → state.addDefect() + dispatcher.emit('defect.detected', …).
//   At every tick-end → recomputeYield() (rolling yield over recent lots); when
//   it drops below kpiThresholds.yield.alert (88) → emit 'yield.alert' (I3).
//
// Drill-down: click a Pareto bar (or its row in the type legend) → ONE-level
//   inline panel listing that defect type's contributing lots (Dialog).
//
// Discipline: chart-kit factories for pareto + trend (axis/tooltip scaffolding
//   centralised there); only the wafer-map canvas is module-local drawing
//   (allowed by the iron rules). All colour/spacing via var(--*) tokens; every
//   user-facing string via t() read at render. Five interaction states (2A):
//   loading / empty (deterministic tick-12 forecast) / error / success / partial.

import * as d3 from 'd3';
import { createBarChart, createLineChart } from '../components/chart-kit.js';
import { Dialog } from '../components/dialog.js';
import { defectTypes, kpiThresholds, products, WAFERS_PER_LOT } from '../scenarios/mom-fab.js';
import { deriveTickSeed } from '../engine/prng.js';

const MODULE_ID = 'yield';
const STYLE_ID = 'module-yield-styles';

// Deterministic-but-quiet ramp constants (all derived from PRNG streams, never
// Math.random). The first inspection batch lands at tick 12 (matches the EMPTY
// forecast copy states.yield.empty); before that the module is genuinely empty.
const FIRST_INSPECTION_TICK = 12;
const TREND_WINDOW = 50; // recent lots shown in the yield trend line
const WAFER_DIAMETER_MM = 300;

// ---------------------------------------------------------------------------
// Module-local styles (token-only; 1px hairlines allowed as literal borders).
// .panel-head / .panel-body are defined per-module exactly like the reference.
// ---------------------------------------------------------------------------
const CSS = `
#content .yield-grid {
  display: grid;
  min-height: 0;
  grid-template-columns: 1fr 360px;
  grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--sp-3);
  height: 100%;
}
#content .yield-grid .y-head {
  grid-column: 1 / 3;
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
}
#content .yield-grid .y-head h1 {
  font-size: var(--fs-title);
  font-weight: var(--fw-emphasis);
  margin: 0;
  letter-spacing: 0.01em;
}
#content .yield-grid .y-head .en {
  color: var(--text-secondary);
  font-size: var(--fs-subtitle);
  font-weight: var(--fw-body);
}
#content .yield-grid .y-head .y-actions {
  margin-left: auto;
  display: flex;
  gap: var(--sp-2);
  align-items: center;
}
#content .yield-grid .y-tick {
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
}
#content .yield-grid .y-tick b { color: var(--accent); font-weight: var(--fw-kpi); }

#content .yield-grid .panel { display: flex; flex-direction: column; min-height: 0; }
#content .yield-grid #y-pareto { grid-column: 1 / 3; }
#content .yield-grid #y-wafer { grid-column: 1 / 2; }
#content .yield-grid #y-trend { grid-column: 2 / 3; }

#content .yield-grid .panel-head {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--hairline);
}
#content .yield-grid .panel-head .label { white-space: nowrap; }
#content .yield-grid .panel-head .meta {
  margin-left: auto;
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
}
#content .yield-grid .panel-body { padding: var(--sp-3); min-height: 0; flex: 1; display: flex; }
#content .yield-grid .panel-body > .ck-host { flex: 1; min-width: 0; min-height: 0; position: relative; }

#content .yield-grid #y-wafer .panel-body { display: grid; place-items: center; padding: var(--sp-2); }
#content .yield-grid #y-wafer canvas { max-width: 100%; height: auto; }

/* Pareto bar is interactive (drill-down) — cyan focus ring on the host. */
#content .yield-grid #y-pareto .ck-host { cursor: pointer; }
#content .yield-grid #y-pareto .ck-host rect.ck-bar { cursor: pointer; }

/* Design-debt polish (T26): mono value label above each Pareto bar — engraved
   count in the accent tone, tabular mono so columns of counts align. */
#content .yield-grid #y-pareto .ck-host text.y-bar-val {
  font: var(--fw-emphasis) var(--chart-axis-fs) var(--font-mono);
  font-variant-numeric: tabular-nums;
  fill: var(--accent);
}

/* drill-down lot list inside the Dialog body */
.yield-drill-list { min-width: 380px; max-height: 320px; overflow-y: auto; }
.yield-drill-summary {
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.yield-drill-list table { width: 100%; }

/* inline ERROR banner (boot-vocabulary, module-level) */
#content .yield-error {
  grid-column: 1 / 3;
  margin: var(--sp-5) auto 0;
  max-width: 520px;
  padding: var(--sp-5);
  text-align: center;
}
#content .yield-error .label { display: block; color: var(--danger); margin-bottom: var(--sp-3); }
#content .yield-error .msg {
  font-size: var(--fs-body); color: var(--text-secondary);
  line-height: 1.6; margin-bottom: var(--sp-4);
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

// Read the current epoch seed (so the defect stream is deterministic per epoch
// and re-seeds cleanly at the loop). Read-only access to the shared scheduler;
// we never mutate app.js / the scheduler. Defaults to 0 when unavailable (node).
function currentEpochSeed() {
  try {
    const s = typeof window !== 'undefined' && window.__SIM && window.__SIM.scheduler;
    return s && Number.isFinite(s.epochSeed) ? s.epochSeed >>> 0 : 0;
  } catch (_) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Defect synthesis — deterministic per (tick, epoch). NO image recognition:
// random hot-spots clustered toward a deterministic "excursion" angle so the
// wafer map shows believable defect signatures (rule: random hot-spots only).
// ---------------------------------------------------------------------------
function defectsForTick(tick, epochSeed) {
  if (tick < FIRST_INSPECTION_TICK) return [];
  const rng = deriveTickSeed('defect.xy', tick, epochSeed);
  // batch size: at least 1 per inspection tick, ramping with tick so the wafer
  // map + pareto visibly accumulate (≥10 dots well before tick 20, still growing).
  const ramp = Math.min(1, (tick - FIRST_INSPECTION_TICK) / 40);
  const count = 1 + Math.floor(rng() * (2 + ramp * 2)); // 1..~5
  const out = [];
  for (let i = 0; i < count; i++) {
    // polar position inside the 300mm wafer; ~60% clustered (signature), rest random.
    const clustered = rng() < 0.6;
    const angle = clustered ? rng() * 1.1 + 3.4 : rng() * Math.PI * 2;
    const radial = clustered ? rng() * 0.32 + 0.42 : rng() * 0.94; // 0..1 of radius
    const x = Math.cos(angle) * radial; // normalized -1..1
    const y = Math.sin(angle) * radial;
    const typeIdx = Math.floor(rng() * defectTypes.length) % defectTypes.length;
    const type = defectTypes[typeIdx].id;
    // attribute the defect to a lot deterministically by index
    const lotIdx = Math.floor(rng() * Math.max(1, _lotIds.length));
    const lotId = _lotIds.length ? _lotIds[lotIdx % _lotIds.length] : `L-${String(i).padStart(3, '0')}`;
    out.push({ tick, lotId, x, y, type });
  }
  return out;
}

// cached lot id list (filled at init from state.lots)
let _lotIds = [];

export default {
  id: MODULE_ID,
  label: 'YLD',

  init(container, ctx) {
    const doc = (container && container.ownerDocument) || document;
    ensureStyles(doc);

    this._ctx = ctx;
    this._container = container;
    this._errored = false;
    this._lastProcessedTick = -1;     // last tick whose defects we generated
    this._lastAlertTick = -1;         // de-dupe yield.alert per tick
    this._selectedType = null;        // current drill-down filter (legend echo)
    this._dialog = null;
    this._raf = null;
    this._focusHandled = false;       // T24: one-shot focus drill guard per mount

    _lotIds = ctx && ctx.state ? Array.from(ctx.state.lots.keys()) : [];

    try {
      this._buildLayout(doc, ctx);
    } catch (err) {
      this._renderError(doc, ctx, err);
      return;
    }

    // I3: own the defect stream + yield recompute. Subscribe so OTHER emitters of
    // defect.detected (e.g. hero scenario injection) also fold into our buffers.
    // We do NOT subscribe to our own emit re-entrantly — emit happens in update().
    if (ctx && ctx.dispatcher) {
      ctx.dispatcher.subscribeAll(MODULE_ID, {
        'defect.detected': (p) => this._onExternalDefect(p),
        'yield.alert': () => {}, // we are the primary emitter; listen for symmetry/no-op
      });
    }
  },

  update(container, ctx, tick) {
    if (this._errored) return;
    const safeTick = Number.isFinite(tick) ? tick : 0;

    // Advance the defect stream only when the tick is NEW (refreshActive re-calls
    // update with the same tick on locale change — must NOT double-generate).
    if (safeTick !== this._lastProcessedTick) {
      this._advanceTo(ctx, safeTick);
      this._lastProcessedTick = safeTick;
    }

    this._render(ctx, safeTick);

    // T24 cross-cutting focus: a defect.detected chip (carrying a defect type)
    // opens that type's drill-down so the related entity is surfaced. One-shot —
    // router clears ctx.focus after this first update, so the dialog only opens
    // from an explicit navigation, never on a later per-tick reconcile.
    const focus = ctx.focus;
    if (focus && focus.payload && focus.payload.type && !this._focusHandled) {
      const dt = defectTypes.find((d) => d.id === focus.payload.type);
      if (dt) { this._focusHandled = true; this._openDrill(dt.name); }
    }
  },

  destroy() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    if (this._dialog) {
      try { this._dialog.close(); } catch (_) { /* noop */ }
      this._dialog = null;
    }
    const ctx = this._ctx;
    if (ctx && ctx.dispatcher) ctx.dispatcher.unsubscribeAll(MODULE_ID);

    // chart-kit destroy() runs selection.interrupt() then .remove() (H4).
    if (this._pareto) { try { this._pareto.destroy(); } catch (_) {} this._pareto = null; }
    if (this._trend) { try { this._trend.destroy(); } catch (_) {} this._trend = null; }

    // Belt-and-braces: interrupt any module-owned d3 transitions then drop DOM.
    if (this._container) {
      d3.select(this._container).selectAll('*').interrupt();
      d3.select(this._container).selectAll('*').remove();
    }
    this._waferCanvas = null;
    this._container = null;
    this._ctx = null;
  },

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------
  _buildLayout(doc, ctx) {
    const t = (ctx && ctx.t) || ((k) => k);
    const grid = doc.createElement('div');
    grid.className = 'yield-grid';

    // header
    const head = doc.createElement('div');
    head.className = 'y-head';
    const h1 = doc.createElement('h1');
    h1.textContent = t('yield.title');
    head.appendChild(h1);
    const badge = doc.createElement('span');
    badge.className = 'badge badge-info';
    badge.id = 'y-badge';
    head.appendChild(badge);
    const actions = doc.createElement('div');
    actions.className = 'y-actions';
    const tickMeter = doc.createElement('span');
    tickMeter.className = 'y-tick';
    tickMeter.id = 'y-tickmeter';
    actions.appendChild(tickMeter);
    head.appendChild(actions);
    grid.appendChild(head);

    // pareto panel
    const pareto = this._panel(doc, 'y-pareto', t('yield.pareto'), 'y-pareto-meta');
    pareto.panel.dataset.mobile = 'rep'; // T33 <768 representative: Yield pareto
    grid.appendChild(pareto.panel);
    this._paretoHost = pareto.host;
    this._paretoMeta = pareto.meta;

    // wafer panel
    const wafer = this._panel(doc, 'y-wafer', t('yield.wafer_map'), 'y-wafer-meta');
    wafer.panel.dataset.mobile = 'hide'; // T33 <768: wafer map hidden
    grid.appendChild(wafer.panel);
    this._waferMeta = wafer.meta;
    const canvas = doc.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    canvas.setAttribute('aria-label', t('yield.wafer_map'));
    wafer.body.replaceChildren(canvas);
    this._waferCanvas = canvas;

    // trend panel
    const trend = this._panel(doc, 'y-trend', t('yield.trend'), 'y-trend-meta');
    trend.panel.dataset.mobile = 'rep'; // T33 <768 representative: Yield trend
    grid.appendChild(trend.panel);
    this._trendHost = trend.host;
    this._trendMeta = trend.meta;

    container_append(this._container, grid);

    // chart-kit factories (axis/tooltip/limit scaffolding centralised; 2A states)
    // Design-debt polish (T26): instrument restraint, not solid-cyan mass bars.
    // Low-saturation fill (~15% accent mixed into the panel ground) reads as a
    // measured quantity rather than a glowing block; the hairline accent-dim
    // stroke + mono value labels above each bar are applied in _tagParetoBars
    // after the chart-kit transition settles (chart-kit is read-only).
    this._pareto = createBarChart({
      emptyI18nKey: 'states.yield.empty',
      predictedTick: FIRST_INSPECTION_TICK,
      ariaLabel: t('yield.pareto'),
      color: 'color-mix(in srgb, var(--accent) 15%, var(--bg-inset))',
    });
    this._pareto.render(this._paretoHost);
    this._pareto.setLoading();

    this._trend = createLineChart({
      emptyI18nKey: 'states.yield.empty',
      predictedTick: FIRST_INSPECTION_TICK,
      partialCapacity: TREND_WINDOW, // <50 lots → PARTIAL (left-anchored, faint right grid)
      ariaLabel: t('yield.trend'),
      color: 'var(--success)',
      cl: kpiThresholds.yield.warn,
      lcl: kpiThresholds.yield.danger,
      sigma: (kpiThresholds.yield.warn - kpiThresholds.yield.danger) / 3,
    });
    this._trend.render(this._trendHost);
    this._trend.setLoading();

    // Pareto drill-down: delegate clicks on bars → dialog with that type's lots.
    this._paretoHost.addEventListener('click', (e) => {
      const bar = e.target && e.target.closest ? e.target.closest('rect.ck-bar') : null;
      if (!bar) return;
      // the bar's bound label is the defect type name; resolve via current data.
      const name = bar.__yieldType;
      if (name) this._openDrill(name);
    });

    this._drawWafer(ctx, 0);
  },

  _panel(doc, id, labelText, metaId) {
    const panel = doc.createElement('div');
    panel.className = 'panel';
    panel.id = id;
    const head = doc.createElement('div');
    head.className = 'panel-head';
    const label = doc.createElement('span');
    label.className = 'label';
    label.textContent = labelText;
    head.appendChild(label);
    const meta = doc.createElement('span');
    meta.className = 'meta';
    meta.id = metaId;
    head.appendChild(meta);
    panel.appendChild(head);
    const body = doc.createElement('div');
    body.className = 'panel-body';
    const host = doc.createElement('div');
    host.className = 'ck-host';
    body.appendChild(host);
    panel.appendChild(body);
    return { panel, head, body, host, meta, label };
  },

  // -------------------------------------------------------------------------
  // Per-tick data advance — generate this tick's defects, push to state, emit,
  // then recompute rolling yield and (conditionally) emit yield.alert (I3).
  // -------------------------------------------------------------------------
  _advanceTo(ctx, tick) {
    if (!ctx || !ctx.state) return;
    const state = ctx.state;
    const epochSeed = currentEpochSeed();

    // Epoch loop: when tick rewinds to 0 the defect ring naturally re-fills from
    // the new epochSeed; the state ring is FIFO-capped so nothing leaks.
    const batch = defectsForTick(tick, epochSeed);
    for (const d of batch) {
      state.addDefect(d);
      if (ctx.dispatcher) {
        // state-first already done (addDefect); now broadcast.
        ctx.dispatcher.emit('defect.detected', {
          tick: d.tick, lotId: d.lotId, type: d.type, x: d.x, y: d.y,
        });
      }
    }

    // I3: rolling yield recompute → state.yieldSamples + conditional alert.
    this._recomputeYield(ctx, tick, epochSeed);
  },

  // Rolling yield %: deterministic from defect density against inspected wafers.
  // Pushes a yield sample (so the trend line + epoch carryover work) and emits
  // yield.alert at most once per tick when below the manifest threshold (88).
  _recomputeYield(ctx, tick, epochSeed) {
    const state = ctx.state;
    if (tick < FIRST_INSPECTION_TICK) return;

    // inspected wafers grow with tick; defects scrap wafers (capped). Add a tiny
    // deterministic jitter via the yield.trend stream so the line is alive.
    const inspected = Math.max(1, (tick - FIRST_INSPECTION_TICK + 1) * WAFERS_PER_LOT);
    const scrapped = Math.min(state.defects.length, inspected);
    const jit = (deriveTickSeed('yield.trend', tick, epochSeed)() - 0.5) * 1.4;
    let pct = Math.max(60, Math.min(100, 100 * (1 - scrapped / inspected) + jit));
    pct = Math.round(pct * 10) / 10;

    // pick a representative product deterministically for the sample tag.
    const prod = products[tick % products.length].id;
    state.addYieldSample({ tick, product: prod, value: pct });
    this._rollingYield = pct;

    if (pct < kpiThresholds.yield.alert && this._lastAlertTick !== tick) {
      this._lastAlertTick = tick;
      if (ctx.dispatcher) {
        ctx.dispatcher.emit('yield.alert', {
          tick, value: pct, threshold: kpiThresholds.yield.alert,
        });
      }
    }
  },

  // External defect.detected (e.g. hero injection) — fold into state so the
  // wafer map + pareto reflect it. Guard against re-counting our own emits by
  // ignoring payloads that originated this tick (they are already in state).
  _onExternalDefect(p) {
    if (!p || !this._ctx || !this._ctx.state) return;
    if (p.tick === this._lastProcessedTick) return; // ours, already added
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return;
    this._ctx.state.addDefect({ tick: p.tick, lotId: p.lotId, x: p.x, y: p.y, type: p.type });
  },

  // -------------------------------------------------------------------------
  // Render (full reconcile; re-reads t() every call — 6A)
  // -------------------------------------------------------------------------
  _render(ctx, tick) {
    if (!ctx || !ctx.state) return;
    const t = ctx.t || ((k) => k);
    const state = ctx.state;
    const defects = state.defects;

    // tick meter
    if (this._tickEl == null) this._tickEl = this._container.querySelector('#y-tickmeter');
    if (this._tickEl) {
      this._tickEl.innerHTML = '';
      this._tickEl.append('tick ');
      const b = document.createElement('b');
      b.className = 'num';
      b.textContent = String(tick).padStart(3, '0');
      this._tickEl.append(b);
      const span = document.createElement('span');
      span.style.opacity = '.5';
      span.textContent = '/180';
      this._tickEl.append(span);
    }

    // ----- Pareto: defect type × count, descending (classic Pareto order) -----
    const counts = new Map();
    for (const dt of defectTypes) counts.set(dt.id, 0);
    for (const d of defects) counts.set(d.type, (counts.get(d.type) || 0) + 1);
    const paretoData = defectTypes
      .map((dt) => ({ label: dt.name, value: counts.get(dt.id) || 0, id: dt.id }))
      .sort((a, b) => b.value - a.value);

    if (defects.length === 0) {
      this._pareto.update([]); // EMPTY (warm copy + ~tick 12 forecast)
    } else {
      this._pareto.update(paretoData); // SUCCESS
    }
    // tag each bar with its type name for drill-down hit-testing (post-transition).
    this._tagParetoBars(paretoData);

    if (this._paretoMeta) {
      this._paretoMeta.textContent = defects.length
        ? `${paretoData.length} types · ${defects.length} defects`
        : '';
    }

    // ----- badge (active drill / alert state) -----
    const badge = this._container.querySelector('#y-badge');
    if (badge) {
      const alerted = this._rollingYield != null && this._rollingYield < kpiThresholds.yield.alert;
      badge.className = 'badge ' + (alerted ? 'badge-danger' : 'badge-info');
      if (this._rollingYield != null) {
        badge.textContent = `${this._rollingYield.toFixed(1)}%`;
      } else {
        badge.textContent = t('yield.title').split('/')[0].trim();
      }
    }

    // ----- Wafer map (canvas) -----
    this._drawWafer(ctx, tick);
    if (this._waferMeta) {
      this._waferMeta.textContent = defects.length ? `${defects.length} defects · ⌀300mm` : '';
    }

    // ----- Yield trend line (recent lots) -----
    const samples = state.yieldSamples.slice(-TREND_WINDOW).map((s) => ({ value: s.value }));
    this._trend.update(samples);
    if (this._trendMeta) {
      this._trendMeta.textContent = samples.length ? `n=${samples.length} · %` : '';
    }
  },

  // After a bar update + transition, attach the type name to each rect so click
  // delegation can resolve it. d3 join keeps order = paretoData order.
  // Design-debt polish (T26): also apply instrument restraint to each bar —
  //   • hairline stroke in accent-dim (the bar reads as an outlined measure)
  //   • mono value label centred above the bar (engraved count, not a glow)
  // chart-kit owns the fill (low-sat color-mix via config.color) + the y/height
  // transition; we layer stroke + label here because chart-kit is read-only.
  _tagParetoBars(paretoData) {
    if (!this._paretoHost) return;
    const bars = this._paretoHost.querySelectorAll('rect.ck-bar');
    bars.forEach((bar, i) => {
      if (paretoData[i]) bar.__yieldType = paretoData[i].label;
      // hairline accent-dim stroke (1px literal allowed by the iron rules).
      bar.setAttribute('stroke', 'var(--accent-dim)');
      bar.setAttribute('stroke-width', '1');
    });

    // Mono value labels above each bar. The bars' y/height animate over the
    // chart-kit 200ms transition, so we place the labels once the transition has
    // settled (single scheduled frame; cancelled in destroy via this._raf). We
    // read each rect's settled top from its own attributes — no private scale.
    const svg = this._paretoHost.querySelector('svg');
    const g = svg && svg.querySelector('g');
    if (!g) return;
    if (this._raf) cancelAnimationFrame(this._raf);
    const place = () => {
      this._raf = null;
      // clear any previous labels (full reconcile — labels are cheap text nodes).
      g.querySelectorAll('text.y-bar-val').forEach((n) => n.remove());
      const liveBars = this._paretoHost.querySelectorAll('rect.ck-bar');
      const NS = 'http://www.w3.org/2000/svg';
      liveBars.forEach((bar, i) => {
        const d = paretoData[i];
        if (!d || !(d.value > 0)) return; // no label on zero-count types
        const x = parseFloat(bar.getAttribute('x')) || 0;
        const w = parseFloat(bar.getAttribute('width')) || 0;
        const y = parseFloat(bar.getAttribute('y')) || 0;
        const label = document.createElementNS(NS, 'text');
        label.setAttribute('class', 'y-bar-val num');
        label.setAttribute('x', String(x + w / 2));
        label.setAttribute('y', String(Math.max(8, y - 4)));
        label.setAttribute('text-anchor', 'middle');
        label.textContent = String(d.value);
        g.appendChild(label);
      });
    };
    // wait out the chart-kit transition (200ms) so the settled top is readable;
    // a chained rAF after a short timeout keeps it off the critical paint path.
    this._raf = requestAnimationFrame(() => {
      setTimeout(() => {
        this._raf = requestAnimationFrame(place);
      }, 210);
    });
  },

  // -------------------------------------------------------------------------
  // Wafer map — module-local canvas (allowed). 300mm circle, concentric rings,
  // crosshair, accent notch, density-coloured defect dots. Matches reference
  // wafer ring/notch craft. Tokens read via getComputedStyle (canvas can't use
  // var() directly), recomputed each call so theme switches reflow correctly.
  // -------------------------------------------------------------------------
  _drawWafer(ctx, tick) {
    const cv = this._waferCanvas;
    if (!cv) return;
    const c = cv.getContext('2d');
    if (!c) return;
    const S = cv.width;
    const R = S / 2 - 8;
    const cx = S / 2;
    const cy = S / 2;
    const css = (n) => {
      try {
        return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
      } catch (_) { return '#888'; }
    };
    const hair = css('--hairline');
    const accent = css('--accent');
    const warn = css('--warn');
    const danger = css('--danger');

    c.clearRect(0, 0, S, S);

    // wafer body + concentric rings
    c.strokeStyle = hair;
    c.lineWidth = 1;
    [1, 0.66, 0.33].forEach((k) => {
      c.beginPath();
      c.arc(cx, cy, R * k, 0, Math.PI * 2);
      c.stroke();
    });
    // crosshair
    c.beginPath();
    c.moveTo(cx - R, cy); c.lineTo(cx + R, cy);
    c.moveTo(cx, cy - R); c.lineTo(cx, cy + R);
    c.stroke();
    // notch (bottom), accent
    c.strokeStyle = accent;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx - 8, cy + R - 2); c.lineTo(cx, cy + R + 6); c.lineTo(cx + 8, cy + R - 2);
    c.stroke();

    // density grid: bin defects into cells so colour = local density.
    const state = ctx.state;
    const defects = state.defects;
    // draw dots; colour by severity-ish density (cluster = danger, sparse = warn)
    const BIN = 5;
    const bins = new Map();
    for (const d of defects) {
      const bx = Math.round(d.x * BIN);
      const by = Math.round(d.y * BIN);
      const key = bx + ',' + by;
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    for (const d of defects) {
      const px = cx + d.x * R;
      const py = cy + d.y * R;
      const bx = Math.round(d.x * BIN);
      const by = Math.round(d.y * BIN);
      const dens = bins.get(bx + ',' + by) || 1;
      c.fillStyle = dens >= 3 ? danger : warn;
      c.globalAlpha = 0.85;
      c.fillRect(px - 1.75, py - 1.75, 3.5, 3.5);
    }
    c.globalAlpha = 1;
  },

  // -------------------------------------------------------------------------
  // Drill-down — ONE level. Click a Pareto bar → Dialog listing that type's lots.
  // -------------------------------------------------------------------------
  _openDrill(typeName) {
    const ctx = this._ctx;
    if (!ctx || !ctx.state) return;
    const t = ctx.t || ((k) => k);
    this._selectedType = typeName;

    const dtMeta = defectTypes.find((d) => d.name === typeName);
    const typeId = dtMeta ? dtMeta.id : null;

    // aggregate this type's lots
    const byLot = new Map();
    for (const d of ctx.state.defects) {
      if (typeId ? d.type === typeId : false) {
        byLot.set(d.lotId, (byLot.get(d.lotId) || 0) + 1);
      }
    }
    const rows = Array.from(byLot.entries())
      .map(([lotId, count]) => ({ lotId, count }))
      .sort((a, b) => b.count - a.count);

    const doc = (this._container && this._container.ownerDocument) || document;
    const body = doc.createElement('div');
    body.className = 'yield-drill-list';

    const summary = doc.createElement('div');
    summary.className = 'yield-drill-summary';
    summary.textContent = `${typeName} · ${rows.length} lots · ${Array.from(byLot.values()).reduce((a, b) => a + b, 0)} defects`;
    body.appendChild(summary);

    const table = doc.createElement('table');
    table.className = 'table';
    const thead = doc.createElement('thead');
    const hr = doc.createElement('tr');
    ['Lot', t('yield.defect_type'), '#'].forEach((label, i) => {
      const th = doc.createElement('th');
      th.textContent = i === 1 ? typeName : label;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    if (rows.length === 0) {
      const tr = doc.createElement('tr');
      tr.style.height = '36px';
      const td = doc.createElement('td');
      td.colSpan = 3;
      td.textContent = t('states.empty');
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      for (const r of rows) {
        const tr = doc.createElement('tr');
        tr.style.height = '36px'; // fixed row height (M6)
        const c1 = doc.createElement('td');
        c1.className = 'num';
        c1.textContent = r.lotId;
        const c2 = doc.createElement('td');
        c2.textContent = typeName;
        const c3 = doc.createElement('td');
        c3.className = 'num';
        c3.textContent = String(r.count);
        tr.append(c1, c2, c3);
        tbody.appendChild(tr);
      }
    }
    table.appendChild(tbody);
    body.appendChild(table);

    if (this._dialog) { try { this._dialog.close(); } catch (_) {} }
    this._dialog = Dialog({
      title: `${t('yield.action.drilldown')} — ${typeName}`,
      body,
      onClose: () => { this._dialog = null; },
    });
  },

  // -------------------------------------------------------------------------
  // ERROR state — inline banner (boot vocabulary) + retry (re-init via router).
  // -------------------------------------------------------------------------
  _renderError(doc, ctx, err) {
    this._errored = true;
    console.warn('[module-yield] init failed:', err && err.message);
    const t = (ctx && ctx.t) || ((k) => k);
    const panel = doc.createElement('div');
    panel.className = 'yield-error panel';
    panel.setAttribute('role', 'alert');
    const label = doc.createElement('span');
    label.className = 'label';
    label.textContent = t('states.error');
    panel.appendChild(label);
    const msg = doc.createElement('div');
    msg.className = 'msg';
    msg.textContent = (err && err.message) || t('states.error');
    panel.appendChild(msg);
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = t('states.action.retry');
    retry.addEventListener('click', () => {
      if (ctx && ctx.router) ctx.router.set(MODULE_ID);
    });
    panel.appendChild(retry);
    container_append(this._container, panel);
  },
};

// helper kept module-scoped (avoid `this` binding surprises in init order)
function container_append(container, node) {
  if (container) container.appendChild(node);
}
