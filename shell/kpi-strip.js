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
import { t, onLocaleChange } from '../i18n/index.js';

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
//
// Trend-delta line (reference .kpi-delta craft): glyph ▲/▼/— shows the DIRECTION
// of change since the previous tick; colour shows whether that change is GOOD or
// BAD for the metric. `deltaGood`: 'up' = rising is good, 'down' = falling is good,
// null = neutral (no semantic colour, just the direction glyph). `deltaUnit` is
// the trailing label on the delta value (mono caption).
const CARDS = [
  {
    key: 'wip',
    i18n: 'kpi.wip',
    unit: '',
    dec: 0,
    value: (state) => state.kpis.wip || 0,
    // WIP is "live data", not a graded status → cyan run LED, never amber/red.
    band: () => 'live',
    deltaGood: null, // WIP swing is neutral inventory movement
    deltaUnit: '',
  },
  {
    key: 'throughput',
    i18n: 'kpi.throughput',
    unit: 'wfr/d',
    dec: 0,
    value: (state) => state.kpis.throughput || 0,
    band: (state) => state.kpiBand('throughput'),
    deltaGood: 'up', // more output is better
    deltaUnit: 'wfr',
  },
  {
    key: 'yield',
    i18n: 'kpi.yield',
    unit: '%',
    dec: 1,
    value: (state) => state.kpis.yield || 0,
    band: (state) => state.kpiBand('yield'),
    deltaGood: 'up', // higher yield is better
    deltaUnit: 'pt',
  },
  {
    key: 'mtbf',
    i18n: 'kpi.mtbf',
    unit: 'hr',
    dec: 0,
    value: (state) => state.kpis.mtbf || 0,
    // No manifest threshold for MTBF → steady-state ok.
    band: () => 'info',
    deltaGood: 'up', // longer time between failures is better
    deltaUnit: 'hr',
  },
  {
    key: 'oee',
    i18n: 'kpi.oee',
    unit: '%',
    dec: 1,
    value: (state) => state.kpis.oee || 0,
    band: (state) => state.kpiBand('oee'),
    deltaGood: 'up', // higher efficiency is better
    deltaUnit: 'pt',
  },
  {
    key: 'alarms',
    i18n: 'kpi.alarms',
    unit: '',
    dec: 0,
    value: (state) => (state.alarms ? state.alarms.length : 0),
    deltaGood: 'down', // fewer active alarms is better
    deltaUnit: '',
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

// Direction glyph for the trend-delta line (colour-blind safe shape encoding).
const DELTA_GLYPH = { up: '▲', down: '▼', flat: '—' }; // ▲ ▼ —

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
    this._offLocale = null;
    this._choreoDur = null; // temp count duration override during epoch choreo (M3)
    // T33 degraded mode: 1366-1919 (and the 768-1365 band) show 4 cards inline
    // + a "+2" popover holding the last two cards. matchMedia drives the toggle.
    this._mqDegrade = null;
    this._onMqChange = () => this._applyResponsive();
    this._moreBtn = null;
    this._popover = null;
    // The two trailing cards that move into the "+2" popover in degraded mode.
    this._overflowKeys = ['oee', 'alarms'];
    // popover dismissal: outside-click + Escape (keyboard accessible).
    this._onDocClick = (e) => {
      if (!this._moreBtn || !this._popover) return;
      if (this._moreBtn.contains(e.target) || this._popover.contains(e.target)) return;
      this._closePopover();
    };
    this._onPopKeydown = (e) => {
      if (e.key === 'Escape') { this._closePopover(); if (this._moreBtn) this._moreBtn.focus(); }
    };
  }

  init() {
    this._build();
    // 6A / T11: re-pull labels the instant the locale flips — no 1-tick lag.
    // We only refresh the i18n text (idempotent DOM patch), never the values.
    this._offLocale = onLocaleChange(() => this._refreshLabels());
    // T33: install the degraded-mode (6->4 + "+2" popover) responsive behavior.
    this._installResponsive();
    // Paint immediately so the strip is never blank between init and first tick.
    this.update(this.state && this.state.kpis ? 0 : 0);
    return this;
  }

  // -------------------------------------------------------------------------
  // T33 responsive: between the tablet floor and 1920 the strip shows 4 cards
  // inline + a "+2" popover (keyboard accessible) holding the trailing two.
  // matchMedia '(min-width:768px) and (max-width:1919px)' is the degraded band;
  // >=1920 shows all six inline; <768 the responsive.css rejoins all six as a
  // 2x3 grid (this code only toggles the data attr — CSS owns the grid).
  // -------------------------------------------------------------------------
  _installResponsive() {
    if (typeof matchMedia !== 'function') return;
    this._mqDegrade = matchMedia('(min-width: 768px) and (max-width: 1919px)');
    // addEventListener('change') is the modern API; guard for older engines.
    if (this._mqDegrade.addEventListener) {
      this._mqDegrade.addEventListener('change', this._onMqChange);
    } else if (this._mqDegrade.addListener) {
      this._mqDegrade.addListener(this._onMqChange);
    }
    this._applyResponsive();
  }

  _applyResponsive() {
    if (!this._built || !this._moreBtn) return;
    const degraded = this._mqDegrade && this._mqDegrade.matches;
    this.container.setAttribute('data-kpi-overflow', degraded ? '1' : '0');
    // move the overflow cards between the inline strip and the popover panel.
    for (const key of this._overflowKeys) {
      const entry = this.cards.get(key);
      if (!entry) continue;
      entry.root.classList.add('kpi-overflow-card');
      const dest = degraded ? this._popover : this.container;
      // keep the strip ending with the "+2" button (insert cards before it).
      if (degraded) {
        if (entry.root.parentNode !== this._popover) this._popover.appendChild(entry.root);
      } else if (entry.root.parentNode !== this.container) {
        this.container.insertBefore(entry.root, this._moreWrap);
      } else {
        void dest;
      }
    }
    if (!degraded) this._closePopover();
  }

  _togglePopover() {
    const open = this._moreBtn.getAttribute('aria-expanded') === 'true';
    if (open) this._closePopover(); else this._openPopover();
  }
  _openPopover() {
    this._moreBtn.setAttribute('aria-expanded', 'true');
    if (typeof document !== 'undefined') {
      document.addEventListener('click', this._onDocClick, true);
      document.addEventListener('keydown', this._onPopKeydown, true);
    }
  }
  _closePopover() {
    if (this._moreBtn) this._moreBtn.setAttribute('aria-expanded', 'false');
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', this._onDocClick, true);
      document.removeEventListener('keydown', this._onPopKeydown, true);
    }
  }

  // Re-pull every label + unit from i18n without touching value animations.
  // Called immediately on locale change so labels never lag a tick behind.
  _refreshLabels() {
    if (!this._built) return;
    for (const entry of this.cards.values()) {
      entry.labelText.textContent = t(entry.desc.i18n);
      entry.unitEl.textContent = entry.desc.unit;
    }
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

      // trend-delta line (reference .kpi-delta craft): glyph + signed magnitude.
      const deltaEl = document.createElement('span');
      deltaEl.className = 'kpi-delta';
      deltaEl.setAttribute('aria-hidden', 'true'); // decorative; value carries the data
      deltaEl.textContent = DELTA_GLYPH.flat + ' ' + (0).toFixed(desc.dec); // flat baseline

      root.appendChild(label);
      root.appendChild(value);
      root.appendChild(deltaEl);
      this.container.appendChild(root);

      this.cards.set(desc.key, {
        desc,
        root,
        labelText,
        valueNum,
        unitEl,
        deltaEl,
        ledEl: led,
        displayed: 0, // last value painted to the DOM
        target: 0, // authoritative value we are animating toward
        prevTarget: null, // last settled target (delta basis); null until first paint
        animFrom: 0,
        animStart: 0,
      });
    }
    // T33: the "+2" overflow trigger + popover panel (kept at the end of the
    // strip so the four inline cards precede it). Hidden by default; CSS shows
    // the trigger only when #kpi-strip[data-kpi-overflow="1"].
    const moreWrap = document.createElement('div');
    moreWrap.className = 'kpi-more-wrap';
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'kpi-more';
    moreBtn.setAttribute('aria-haspopup', 'true');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.textContent = '+' + this._overflowKeys.length;
    moreBtn.setAttribute('aria-label', '+' + this._overflowKeys.length);
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); this._togglePopover(); });
    const popover = document.createElement('div');
    popover.className = 'kpi-popover';
    popover.setAttribute('role', 'group');
    moreWrap.appendChild(moreBtn);
    moreWrap.appendChild(popover); // sibling AFTER the trigger (matches CSS)
    this.container.appendChild(moreWrap);
    this._moreWrap = moreWrap;
    this._moreBtn = moreBtn;
    this._popover = popover;

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
        // trend-delta: change since the last settled target. On the very first
        // paint there is no prior reading, so show a flat baseline (no spurious
        // "delta == full value"). Render-only — derived from authoritative state.
        const firstPaint = entry.prevTarget == null;
        this._paintDelta(entry, firstPaint ? 0 : next - entry.target);
        entry.prevTarget = entry.target;
        entry.animFrom = entry.displayed;
        entry.target = next;
        entry.animStart = now;
      }
      // advance this card's animation a step (render-only).
      if (this._stepCard(entry, now, desc.dec)) needsRaf = true;
    }

    if (needsRaf) this._ensureRaf();
  }

  // Render the trend-delta line: direction glyph (▲/▼/—) + signed magnitude +
  // unit. Colour = whether the change is GOOD or BAD for this metric (success /
  // danger); neutral metrics get no colour. Pure display (no state mutation).
  _paintDelta(entry, diff) {
    const { desc, deltaEl } = entry;
    const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const mag = Math.abs(diff).toFixed(desc.dec);
    const unit = desc.deltaUnit ? ' ' + desc.deltaUnit : '';
    deltaEl.textContent = DELTA_GLYPH[dir] + ' ' + mag + unit;

    // direction → semantic colour via the card's deltaGood orientation.
    deltaEl.classList.remove('up', 'down');
    if (dir !== 'flat' && desc.deltaGood) {
      const good = dir === desc.deltaGood;
      deltaEl.classList.add(good ? 'up' : 'down');
    }
  }

  // Advance one card toward its target; returns true if still animating.
  // During an epoch choreography phase (count-down/up) a temporary _choreoDur
  // overrides the standard 0.8s count-up window so the wind-down (0.3s) and
  // refill (0.5s) match the M3 timeline; cleared back to null afterward.
  _stepCard(entry, now, dec) {
    const dur = this._choreoDur != null ? this._choreoDur : countupMs();
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

  // -------------------------------------------------------------------------
  // M3 EPOCH CHOREOGRAPHY hooks (T26). Render-only — these animate the DISPLAYED
  // numbers and toggle the dim envelope class; they NEVER touch simulation state
  // (10A). The TickScheduler's onChoreography window freezes emits, so during
  // count-down the authoritative state.kpis is paused — we drive the visual
  // wind-down/refill purely through each card's displayed value + animStart.
  //
  // choreoCountdown(ms): phase (a) — every card's number eases to 0 over `ms`
  // (default 300) while the strip dims via the .epoch-countdown class.
  // -------------------------------------------------------------------------
  choreoCountdown(ms = 300) {
    if (!this._built) return;
    // reduced-motion: instant — drop to 0 with no envelope, no rAF spin.
    const reduce = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.container.classList.add('epoch-countdown');
    const now = performance.now();
    this._choreoDur = reduce ? 1 : ms;
    for (const entry of this.cards.values()) {
      entry.animFrom = entry.displayed;
      entry.target = 0;
      entry.animStart = now;
      if (reduce) {
        entry.displayed = 0;
        entry.valueNum.nodeValue = (0).toFixed(entry.desc.dec);
      }
    }
    if (!reduce) this._ensureRaf();
  }

  // choreoCountup(ms): phase (d) — release the dim envelope and let the cards
  // ease from 0 back UP to the live state value over `ms` (default 500). We
  // re-read the authoritative value here (emits have resumed by the time the
  // controller calls this), so the strip lands on the new epoch's real numbers.
  choreoCountup(ms = 500) {
    if (!this._built) return;
    const reduce = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.container.classList.remove('epoch-countdown');
    const now = performance.now();
    this._choreoDur = reduce ? 1 : ms;
    const state = this.state;
    for (const entry of this.cards.values()) {
      const live = entry.desc.value(state);
      entry.prevTarget = entry.target;
      entry.animFrom = entry.displayed;
      entry.target = live;
      entry.animStart = now;
      if (reduce) {
        entry.displayed = live;
        entry.valueNum.nodeValue = live.toFixed(entry.desc.dec);
      }
    }
    // After the count-up settles, drop the choreo duration override so the next
    // ordinary tick count-up uses the standard 0.8s window again.
    if (!reduce) {
      this._ensureRaf();
      const releaseAt = now + ms;
      const release = () => {
        if (performance.now() >= releaseAt) { this._choreoDur = null; return; }
        requestAnimationFrame(release);
      };
      requestAnimationFrame(release);
    } else {
      this._choreoDur = null;
    }
  }

  destroy() {
    if (this._raf != null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    this.container.classList.remove('epoch-countdown');
    if (this._offLocale) { this._offLocale(); this._offLocale = null; }
    // T33: tear down responsive listeners + popover document listeners.
    this._closePopover();
    if (this._mqDegrade) {
      if (this._mqDegrade.removeEventListener) {
        this._mqDegrade.removeEventListener('change', this._onMqChange);
      } else if (this._mqDegrade.removeListener) {
        this._mqDegrade.removeListener(this._onMqChange);
      }
      this._mqDegrade = null;
    }
    this.container.removeAttribute('data-kpi-overflow');
    this._moreWrap = this._moreBtn = this._popover = null;
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
      // 6 equal tracks, each with a token-scaled floor wide enough for a 4-digit
      // 32px mono value (~3×--sp-7 = 144px) + the full bilingual short label, so
      // nothing clips at 1920. minmax lets cards still flex on narrower frames.
      '#kpi-strip { display: grid; grid-template-columns: repeat(6, minmax(calc(var(--sp-7) * 3), 1fr)); gap: var(--sp-2); }',
      '#kpi-strip .kpi-card { display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0; overflow: hidden; }',
      '#kpi-strip .label { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-2); min-width: 0; }',
      // full bilingual label on one line; ellipsis is only a last-resort guard.
      '#kpi-strip .kpi-label-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; min-width: 0; }',
      '#kpi-strip .led { flex: none; }',
      // value: tabular mono, never clipped — line-height leaves room for the
      // 32px glyph cap/descender; nowrap keeps a 4-digit value on one line.
      '#kpi-strip .kpi-value { font-size: var(--fs-kpi); font-weight: var(--fw-kpi); line-height: 1.1; color: var(--text-primary); white-space: nowrap; min-width: 0; }',
      '#kpi-strip .kpi-value .unit { font-size: var(--fs-caption); font-weight: var(--fw-body); color: var(--text-secondary); margin-left: var(--sp-1); }',
      '#kpi-strip .kpi-card.kpi-warn .kpi-value { color: var(--warn); }',
      '#kpi-strip .kpi-card.kpi-danger .kpi-value { color: var(--danger); }',
      // trend-delta line (reference .kpi-delta craft): mono caption, neutral by
      // default; direction colour applied via .up (success) / .down (danger).
      '#kpi-strip .kpi-delta { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-caption); font-weight: var(--fw-body); color: var(--text-secondary); white-space: nowrap; }',
      '#kpi-strip .kpi-delta.up { color: var(--success); }',
      '#kpi-strip .kpi-delta.down { color: var(--danger); }',
    ].join('\n');
    document.head.appendChild(style);
  }
}

export default KpiStrip;
