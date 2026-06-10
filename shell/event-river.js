// shell/event-river.js — 頂部事件河 (T12).
// A left-drifting "event ribbon": every dispatcher event becomes a craft chip
// (reference-spc.html .chip vocabulary — shape glyph + mono label). Subscribes
// to ALL dispatcher event types via subscribeAll('event-river', ...).
//
// Spec (M5 + T33 + 6A):
//   - chip count = floor(containerWidth / CHIP_SLOT) min CHIP_MIN (container-
//     relative, never hardcoded 15); overflow surfaces a "+N" indicator.
//   - PRIORITY LANE: spc.violation / equipment.alarm / defect.detected are
//     pinned leftmost with danger styling + pulse, regardless of arrival order.
//   - per-chip CSS animation: fade-in + 12px slide entry, slow linear drift,
//     exit left — NEVER a container translateX.
//   - chip click dispatches a navigation intent per scenarios EVENT_ROUTING
//     (event detail only; the SPA router arrives in T13 and listens for it).
//   - container is role="log" aria-live="off" (set in index.html shell): per-tick
//     updates would flood a screen reader, so auto-announce is off — individual
//     alarms reach AT via the toast assertive live region instead.
//
// Styling: zero raw literals — chip CSS is injected once as token-only rules so
// the rule "all styling through tokens.css + theme.css variables" holds while we
// stay inside this task's files (theme.css is not ours to edit).

import { eventRouting } from '../scenarios/mom-fab.js';
import { t, onLocaleChange } from '../i18n/index.js';

// --- layout constants (container-relative chip budget) ----------------------
const CHIP_SLOT = 160; // px per chip slot — T33 "floor(width/160)"
const CHIP_MIN = 6;    // never show fewer than 6 chips

// --- event-type → semantic posture -----------------------------------------
// Priority types are pinned leftmost with danger styling + pulse. Colours map
// ONLY to existing design tokens (no --purple exists; recipe.changed falls back
// to the neutral secondary tone rather than inventing a literal).
const PRIORITY_TYPES = new Set(['spc.violation', 'equipment.alarm', 'defect.detected']);

// glyph + tone class per type. Tone classes are token-backed (see injected CSS).
const CHIP_GLYPH = {
  'lot.start': '●',
  'lot.complete': '●',
  'step.transition': '→',
  'equipment.alarm': '■',
  'equipment.idle': '○',
  'spc.violation': '▲',
  'apc.adjustment': '◆',
  'defect.detected': '◆',
  'recipe.changed': '◇',
  'yield.alert': '▲',
  'po.received': '▢',
  'material.in_transit': '→',
};
const CHIP_TONE = {
  'lot.start': 'tone-accent',
  'lot.complete': 'tone-success',
  'step.transition': 'tone-muted',
  'equipment.alarm': 'tone-danger',
  'equipment.idle': 'tone-muted',
  'spc.violation': 'tone-danger',
  'apc.adjustment': 'tone-accent',
  'defect.detected': 'tone-warn',
  'recipe.changed': 'tone-muted',
  'yield.alert': 'tone-warn',
  'po.received': 'tone-muted',
  'material.in_transit': 'tone-muted',
};

// All known event types (drives subscribeAll handler map).
const EVENT_TYPES = Object.keys(eventRouting);

// --- injected, token-only stylesheet (once per document) --------------------
const STYLE_ID = 'event-river-styles';
const CSS = `
#event-river {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 0 1 auto;
  min-width: 0;
  height: 38px;
  overflow: hidden;
}
#event-river .river-track {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}
#event-river .river-empty {
  font-size: var(--fs-caption);
  font-weight: var(--fw-emphasis);
  letter-spacing: var(--label-tracking);
  color: var(--text-secondary);
  white-space: nowrap;
}
#event-river .river-error {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-caption);
  color: var(--danger);
  white-space: nowrap;
}
.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  font-variant-numeric: tabular-nums;
  padding: 3px var(--sp-2);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  transition: border-color var(--transition), box-shadow var(--transition);
  animation: chip-enter var(--countup, 800ms) var(--ease-instrument) both;
}
.chip:hover { border-color: var(--accent-dim); box-shadow: var(--sh-sm); }
.chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.chip b { color: var(--text-primary); font-weight: var(--fw-emphasis); }
.chip .chip-glyph { font-weight: var(--fw-emphasis); }
.chip.exiting { animation: chip-exit var(--transition) var(--ease-instrument) both; }

.chip.tone-accent  { color: var(--accent); border-color: var(--accent-dim); }
.chip.tone-accent b { color: var(--accent); }
.chip.tone-success { color: var(--success); }
.chip.tone-success b { color: var(--success); }
.chip.tone-warn    { color: var(--warn); }
.chip.tone-warn b  { color: var(--warn); }
.chip.tone-danger  { color: var(--danger); }
.chip.tone-danger b { color: var(--danger); }
.chip.tone-muted   { color: var(--text-secondary); }

/* priority lane: pinned leftmost, danger glow + pulse aligned to 2× tick */
.chip.pri {
  border-color: var(--danger);
  color: var(--danger);
  animation: chip-enter var(--countup, 800ms) var(--ease-instrument) both,
             pri-pulse calc(var(--tick) * 2) ease-in-out infinite;
}
.chip.pri b { color: var(--danger); }
.chip.pri.tone-warn { border-color: var(--warn); color: var(--warn); }
.chip.pri.tone-warn b { color: var(--warn); }

#event-river .river-more {
  flex: none;
  margin-left: auto;
  padding-left: var(--sp-1);
  font: var(--fw-emphasis) var(--fs-caption) var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

@keyframes chip-enter {
  from { opacity: 0; transform: translateX(12px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes chip-exit {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(-12px); }
}
@keyframes pri-pulse {
  50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 18%, transparent); }
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

// derive the short bold label + tail from an event payload (defensive: payloads
// vary by producer; we read common keys and fall back to the i18n type label).
function chipParts(type, payload) {
  const p = payload || {};
  const id = p.lotId || p.lot || p.equipmentId || p.equipment || p.poId ||
             p.recipeId || p.id || null;
  const tail = p.step || p.tool || p.note || p.module || p.param || p.supplier || null;
  return { id, tail };
}

export class EventRiver {
  constructor({ container, dispatcher, onNavigate } = {}) {
    this.container = container;
    this.dispatcher = dispatcher;
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;
    this._events = [];        // chronological store (oldest → newest)
    this._seq = 0;            // deterministic id (no Date.now / Math.random)
    this._capacity = CHIP_MIN;
    this._mounted = false;
    this._offLocale = null;
    this._onResize = () => this._recomputeCapacity();
    this._onClick = (e) => this._handleClick(e);
  }

  mount() {
    if (this._mounted || !this.container) return;
    const doc = this.container.ownerDocument || document;
    ensureStyles(doc);

    // structure: [track][+N more]. Track holds the chips; more is the overflow
    // indicator. We patch innerHTML on the track only (idempotent full reconcile).
    this.container.innerHTML = '';
    this._track = doc.createElement('div');
    this._track.className = 'river-track';
    this._more = doc.createElement('span');
    this._more.className = 'river-more';
    this._more.hidden = true;
    this.container.appendChild(this._track);
    this.container.appendChild(this._more);

    this._recomputeCapacity();
    this._renderEmpty();

    // subscribeAll: one handler per known event type → push into the store.
    const handlers = {};
    for (const type of EVENT_TYPES) {
      handlers[type] = (payload) => this._ingest(type, payload);
    }
    this.dispatcher.subscribeAll('event-river', handlers);

    this.container.addEventListener('click', this._onClick);
    if (typeof window !== 'undefined') window.addEventListener('resize', this._onResize);
    // 6A: re-render on locale change so already-mounted chips re-pull t(key).
    this._offLocale = onLocaleChange(() => this._render());
    this._mounted = true;
  }

  destroy() {
    if (!this._mounted) return;
    this.dispatcher.unsubscribeAll('event-river');
    if (this._offLocale) { this._offLocale(); this._offLocale = null; }
    this.container.removeEventListener('click', this._onClick);
    if (typeof window !== 'undefined') window.removeEventListener('resize', this._onResize);
    this.container.innerHTML = '';
    this._events = [];
    this._mounted = false;
  }

  // --- state-first: mutate the store, then patch the DOM (2B) ---------------
  _ingest(type, payload) {
    const ev = {
      seq: this._seq++,
      type,
      payload: payload || {},
      priority: PRIORITY_TYPES.has(type),
      module: eventRouting[type] || null,
    };
    this._events.push(ev);
    // cap retained history at 2× the largest plausible capacity so the store
    // never grows unbounded; the visible slice is computed in _render.
    const HARD_CAP = 60;
    if (this._events.length > HARD_CAP) this._events.splice(0, this._events.length - HARD_CAP);
    this._render();
  }

  _recomputeCapacity() {
    const w = (this.container && this.container.clientWidth) || 0;
    const next = Math.max(CHIP_MIN, Math.floor(w / CHIP_SLOT) || 0);
    if (next !== this._capacity) {
      this._capacity = next;
      this._render();
    }
  }

  // ordering: priority chips pinned leftmost (newest priority first), then the
  // most-recent normal chips. The visible slice is the first `capacity` of that
  // ordered list; everything beyond becomes the "+N" overflow count.
  _ordered() {
    const pri = [];
    const normal = [];
    // iterate newest → oldest so the freshest events are nearest the head.
    for (let i = this._events.length - 1; i >= 0; i--) {
      const ev = this._events[i];
      (ev.priority ? pri : normal).push(ev);
    }
    return pri.concat(normal);
  }

  _render() {
    if (!this._mounted && !this._track) return;
    if (this._events.length === 0) { this._renderEmpty(); return; }

    const ordered = this._ordered();
    const visible = ordered.slice(0, this._capacity);
    const overflow = ordered.length - visible.length;

    const doc = this.container.ownerDocument || document;
    // full reconcile: rebuild the track from the visible slice. Chips are cheap
    // and the slice is tiny (≤ ~12), so a clean rebuild keeps state↔DOM in lock.
    this._track.textContent = '';
    for (const ev of visible) {
      this._track.appendChild(this._buildChip(doc, ev));
    }

    if (overflow > 0) {
      this._more.hidden = false;
      this._more.textContent = '+' + overflow;
    } else {
      this._more.hidden = true;
      this._more.textContent = '';
    }
  }

  _renderEmpty() {
    if (!this._track) return;
    this._track.textContent = '';
    this._more.hidden = true;
    const doc = this.container.ownerDocument || document;
    const span = doc.createElement('span');
    span.className = 'river-empty';
    span.textContent = t('states.event.empty'); // i18n: read at render time (6A)
    this._track.appendChild(span);
  }

  _buildChip(doc, ev) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'chip ' + (CHIP_TONE[ev.type] || 'tone-muted');
    if (ev.priority) chip.classList.add('pri');
    chip.dataset.eventType = ev.type;
    chip.dataset.module = ev.module || '';
    chip.dataset.seq = String(ev.seq);

    const { id, tail } = chipParts(ev.type, ev.payload);

    const glyph = doc.createElement('span');
    glyph.className = 'chip-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = CHIP_GLYPH[ev.type] || '●';
    chip.appendChild(glyph);

    const strong = doc.createElement('b');
    // i18n label read at render (never cached). Bold slot prefers a concrete id.
    strong.textContent = id != null ? String(id) : t('event.' + ev.type);
    chip.appendChild(strong);

    if (id != null) {
      const lbl = doc.createElement('span');
      lbl.textContent = ' ' + t('event.' + ev.type);
      chip.appendChild(lbl);
    }
    if (tail != null) {
      const tailEl = doc.createElement('span');
      tailEl.textContent = ' · ' + tail;
      chip.appendChild(tailEl);
    }

    // accessible name: type label + id (+ tail), composed from i18n at render.
    chip.setAttribute('aria-label',
      t('event.' + ev.type) + (id != null ? ' ' + id : '') + (tail != null ? ' ' + tail : ''));
    return chip;
  }

  _handleClick(e) {
    const chip = e.target.closest && e.target.closest('.chip');
    if (!chip || !this.container.contains(chip)) return;
    const type = chip.dataset.eventType;
    const module = chip.dataset.module || eventRouting[type] || null;
    const detail = { module, type, seq: Number(chip.dataset.seq) };

    // navigation intent — event detail only. The SPA router (T13) listens for
    // this CustomEvent on the container; until then it is a no-op carrier.
    const navEvent = new CustomEvent('river:navigate', { detail, bubbles: true });
    chip.dispatchEvent(navEvent);
    if (this.onNavigate && module) this.onNavigate(module, detail);
  }
}

export function createEventRiver(opts) {
  const river = new EventRiver(opts);
  river.mount();
  return river;
}

export default createEventRiver;
