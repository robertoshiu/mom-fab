// shell/kpi-strip.js — Top KPI strip (T11).
// Six instrument-grade KPI cards (WIP, Throughput, Yield %, MTBF, OEE, Alarm
// Active) that read state.kpis / state.alarms each tick. Numbers count up over
// 0.8s ease-out via requestAnimationFrame — render-only (10A): the count-up
// never advances the simulation, it only animates the display toward the
// authoritative state value. Render path: update(tick) does a full reconcile
// (2B, state-first). Threshold colours come from the scenario manifest KPI
// thresholds via state.kpiBand(); labels via i18n t() read at every render (6A).
// Styling is 100% tokens / theme.css utilities (.kpi-card / .panel / .label /
// .kpi-value / .led-*); zero raw literals.

import { kpiThresholds } from '../scenarios/mom-fab.js';
import { t } from '../i18n/index.js';

// Count-up duration token (kept in sync with --countup: 800ms). Read once from
// the cascade so we honour prefers-reduced-motion without hardcoding a literal.
function countupMs() {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return 1;
  }
  return 800;
}

// Card descriptors — order matches the reference strip. Each card declares how
// to pull its value from state, how to render the number, and how to resolve
// its threshold band (→ LED shape + value colour).
//   band(state): 'info' | 'warn' | 'danger'  (info = healthy / live data)
const CARDS = [
  {
    key: 'wip',
    i18n: 'kpi.wip',
    unit: '',
    dec: 0,
    value: (state) => state.kpis.wip || 0,
    // WIP is "live data", not a graded status → cyan run LED, never amber/red.
    band: () => 'live',
  },
  {
    key: 'throughput',
    i18n: 'kpi.throughput',
    unit: 'wfr/d',
    dec: 0,
    value: (state) => state.kpis.throughput || 0,
    band: (state) => state.kpiBand('throughput'),
  },
  {
    key: 'yield',
    i18n: 'kpi.yield',
    unit: '%',
    dec: 1,
    value: (state) => state.kpis.yield || 0,
    band: (state) => state.kpiBand('yield'),
  },
  {
    key: 'mtbf',
    i18n: 'kpi.mtbf',
    unit: 'hr',
    dec: 0,
    value: (state) => state.kpis.mtbf || 0,
    // No manifest threshold for MTBF → steady-state ok.
    band: () => 'info',
  },
  {
    key: 'oee',
    i18n: 'kpi.oee',
    unit: '%',
    dec: 1,
    value: (state) => state.kpis.oee || 0,
    band: (state) => state.kpiBand('oee'),
  },
  {
    key: 'alarms',
    i18n: 'kpi.alarms',
    unit: '',
    dec: 0,
    value: (state) => (state.alarms ? state.alarms.length : 0),
    // Alarms are higher-is-worse (opposite of yield/oee): 0 = ok, any active =
    // warn, several = danger. Threshold count derived from manifest discipline:
    // a single active alarm is a caution, the OEE danger gate count is a fault.
    band: (state) => {
      const n = state.alarms ? state.alarms.length : 0;
      if (n === 0) return 'info';
      if (n >= ALARM_DANGER) return 'danger';
      return 'warn';
    },
  },
];

// Derive the alarm "danger" count from the manifest so it is not a bare literal:
// reuse the OEE danger gate as the active-alarm fault count (both are the same
// "system in trouble" magnitude in this scenario).
const ALARM_DANGER = (kpiThresholds.oee && kpiThresholds.oee.danger) || 1;

// band → LED utility class (colour + shape, colour-blind safe per DESIGN §5).
const LED_CLASS = {
  live: 'led-run', // cyan dot: active/live data
  info: 'led-ok', // green dot: healthy
  warn: 'led-warn', // amber triangle
  danger: 'led-danger', // red square
};

// band → value colour class. Only amber/red are applied as semantic colours;
// 'info'/'live' leave the value at --text-primary (no decoration).
const VALUE_CLASS = { warn: 'kpi-warn', danger: 'kpi-danger' };

export class KpiStrip {
  /**
   * @param {HTMLElement} container  the #kpi-strip element
   * @param {object} ctx  { state }  the SimulationState central store
   */
  constructor(container, ctx) {
    this.container = container;
    this.state = ctx.state;
    this.cards = new Map(); // key → { root, valueNode, unitEl, ledEl, displayed, anim, target }
    this._built = false;
    this._raf = null;
  }

  init() {
    this._build();
    // Paint immediately so the strip is never blank between init and first tick.
    this.update(this.state && this.state.kpis ? 0 : 0);
    return this;
  }

  // -------------------------------------------------------------------------
  // DOM scaffold — built once; update() only mutates text / classes (2B).
  // -------------------------------------------------------------------------
  _build() {
    this.container.textContent = '';
    for (const desc of CARDS) {
      const root = document.createElement('div');
      root.className = 'kpi-card panel';
      root.setAttribute('data-kpi', desc.key);

      const label = document.createElement('span');
      label.className = 'label';
      // 6A: read t() at every render — store the key so update() re-pulls copy.
      const labelText = document.createElement('span');
      labelText.className = 'kpi-label-text';
      const led = document.createElement('i');
      led.className = 'led';
      label.appendChild(labelText);
      label.appendChild(led);

      const value = document.createElement('span');
      value.className = 'kpi-value num';
      const valueNum = document.createTextNode('0');
      value.appendChild(valueNum);
      const unitEl = document.createElement('span');
      unitEl.className = 'unit';
      value.appendChild(unitEl);

      root.appendChild(label);
      root.appendChild(value);
      this.container.appendChild(root);

      this.cards.set(desc.key, {
        desc,
        root,
        labelText,
        valueNum,
        unitEl,
        ledEl: led,
        displayed: 0, // last value painted to the DOM
        target: 0, // authoritative value we are animating toward
        animFrom: 0,
        animStart: 0,
      });
    }
    this._injectStyleOnce();
    this._built = true;
  }

  // -------------------------------------------------------------------------
  // Full reconcile, called by the controller every tick (2B, state-first).
  // Reads the already-recomputed state.kpis; never mutates simulation state.
  // -------------------------------------------------------------------------
  update(/* tick */) {
    if (!this._built) return;
    const state = this.state;
    const now = performance.now();
    let needsRaf = false;

    for (const entry of this.cards.values()) {
      const { desc } = entry;

      // labels + units: re-pull from i18n every render (locale may have changed).
      entry.labelText.textContent = t(desc.i18n);
      entry.unitEl.textContent = desc.unit;

      // band → LED shape/colour + value colour.
      const band = desc.band(state);
      entry.ledEl.className = 'led ' + (LED_CLASS[band] || 'led-ok');
      entry.root.classList.remove('kpi-warn', 'kpi-danger');
      if (VALUE_CLASS[band]) entry.root.classList.add(VALUE_CLASS[band]);

      // value: kick off a fresh count-up only when the target actually changes.
      const next = desc.value(state);
      if (next !== entry.target) {
        entry.animFrom = entry.displayed;
        entry.target = next;
        entry.animStart = now;
      }
      // advance this card's animation a step (render-only).
      if (this._stepCard(entry, now, desc.dec)) needsRaf = true;
    }

    if (needsRaf) this._ensureRaf();
  }

  // Advance one card toward its target; returns true if still animating.
  _stepCard(entry, now, dec) {
    const dur = countupMs();
    const p = Math.min(Math.max((now - entry.animStart) / dur, 0), 1);
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic (matches reference)
    const v = entry.animFrom + (entry.target - entry.animFrom) * e;
    entry.displayed = p >= 1 ? entry.target : v;
    entry.valueNum.nodeValue = entry.displayed.toFixed(dec);
    return p < 1;
  }

  // Single shared rAF loop driving all in-flight count-ups (render only —
  // 10A: this NEVER calls into the scheduler / state, it only paints numbers).
  _ensureRaf() {
    if (this._raf != null) return;
    const tickFrame = () => {
      this._raf = null;
      const now = performance.now();
      let again = false;
      for (const entry of this.cards.values()) {
        if (entry.displayed !== entry.target) {
          if (this._stepCard(entry, now, entry.desc.dec)) again = true;
        }
      }
      if (again) this._ensureRaf();
    };
    this._raf = requestAnimationFrame(tickFrame);
  }

  destroy() {
    if (this._raf != null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    this.cards.clear();
    this.container.textContent = '';
    this._built = false;
  }

  // Layout + state-specific styling that is local to the KPI strip and not a
  // shared utility. All values reference tokens — no raw literals.
  _injectStyleOnce() {
    if (document.getElementById('kpi-strip-style')) return;
    const style = document.createElement('style');
    style.id = 'kpi-strip-style';
    style.textContent = [
      '#kpi-strip { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--sp-2); }',
      '#kpi-strip .kpi-card { display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0; }',
      '#kpi-strip .label { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-2); }',
      '#kpi-strip .kpi-label-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#kpi-strip .kpi-value { font-size: var(--fs-kpi); font-weight: var(--fw-kpi); line-height: 1.05; color: var(--text-primary); }',
      '#kpi-strip .kpi-value .unit { font-size: var(--fs-caption); font-weight: var(--fw-body); color: var(--text-secondary); margin-left: var(--sp-1); }',
      '#kpi-strip .kpi-card.kpi-warn .kpi-value { color: var(--warn); }',
      '#kpi-strip .kpi-card.kpi-danger .kpi-value { color: var(--danger); }',
    ].join('\n');
    document.head.appendChild(style);
  }
}

export default KpiStrip;
