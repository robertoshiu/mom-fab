// components/spotlight.js — guided-tour overlay + coach-mark (M1).
//
// One fixed overlay (z var(--z-tour-overlay)) with an SVG mask cutout around the
// target, a breathing 1px cyan hairline ring on the cutout, and an anchored
// callout panel (z var(--z-tour-callout)) carrying the step copy + controls. All
// chrome is .panel vocabulary (bezel ticks come free); ALL copy arrives as text
// the engine resolved from i18n and we render with textContent ONLY (F11).
//
// The component is "dumb": the tour-engine owns sequencing and hands us per-step
// view-models (createSpotlight().showAnchored/showCentered/showFinal/…). We own
// geometry (mask cutout, callout placement, bottom-sheet), the countdown ring,
// the focus trap (SUSPENDED while a .dialog-backdrop exists — F4), and aria-live.
//
// Styling: layout CSS injected once (the established shell pattern); shared MOTION
// (breathing ring, callout enter/exit, ring transition, skeleton shimmer) lives in
// styles/animations.css. 1px hairlines are the only literals (iron-rule exempt).

const STYLE_ID = 'tour-spotlight-styles';
const NS = 'http://www.w3.org/2000/svg';
const MOBILE_BP = 768;
const RING_DIAMETER = 28; // DS-8: countdown ring diameter (= Next button height)
const RING_STROKE = 2;

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Layout-only stylesheet; every value is a token. The 1px ring stroke + the SVG
// mask are the only non-token primitives (hairline + geometry, both exempt).
const CSS = `
.tour-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-tour-overlay);
  pointer-events: auto;
}
.tour-overlay svg.tour-mask {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.tour-overlay .tour-scrim-fill { fill: var(--tour-scrim); }
.tour-cutout-ring {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1;
}

.tour-callout {
  position: fixed;
  z-index: var(--z-tour-callout);
  box-sizing: border-box;
  max-width: 520px;
  min-width: 280px;
  width: max-content;
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--hairline);
  padding: var(--sp-4) var(--sp-5);
  box-shadow: var(--sh-lg);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.tour-callout .tour-title {
  display: block;
  color: var(--accent);
}
.tour-callout .tour-body {
  font-size: var(--fs-body);
  color: var(--text-primary);
  line-height: 1.55;
  margin: 0;
}
.tour-callout .tour-note {
  font-size: var(--fs-body);
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}
.tour-callout .tour-glyph {
  color: var(--text-secondary);
  font-size: var(--fs-title);
  line-height: 1;
}
.tour-callout .tour-footer {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-top: var(--sp-2);
  color: var(--text-secondary);
}
.tour-callout .tour-counter {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-right: auto;
}
.tour-callout .tour-controls {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.tour-callout .tour-btn {
  min-height: 44px;
  min-width: 44px;
  padding: var(--sp-1) var(--sp-3);
}
.tour-callout .tour-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

/* auto-mode countdown ring — low-contrast 2px arc, parked beside Next (DS-8). */
.tour-ring {
  width: ${RING_DIAMETER}px;
  height: ${RING_DIAMETER}px;
  flex: none;
}
.tour-ring .tour-ring-track {
  fill: none;
  stroke: var(--hairline);
  stroke-width: ${RING_STROKE};
}
.tour-ring .tour-ring-arc {
  fill: none;
  stroke: var(--accent);
  stroke-width: ${RING_STROKE};
  opacity: 0.35;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: center;
}
/* reduced-motion dwell highlight: no ring, the Next button gets a live border. */
.tour-callout.is-dwell .tour-next {
  border-color: var(--accent);
  color: var(--accent);
}

/* "next station" transition card (DS-3) — centered skeleton, never a spinner. */
.tour-callout.tour-transition {
  align-items: stretch;
}
.tour-callout .tour-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
.tour-callout .tour-skeleton-bar {
  height: var(--sp-2);
  border-radius: var(--r-card);
}
.tour-callout .tour-skeleton-bar.is-short { width: 60%; }

/* centered / final / transition cards sit dead-centre, no cutout. */
.tour-callout.is-centered {
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

/* <768: bottom-sheet posture. The cutout target is scrolled into the upper
   viewport by the engine so it stays visible above the sheet (DS-7). */
@media (max-width: ${MOBILE_BP - 1}px) {
  .tour-callout {
    left: var(--sp-3) !important;
    right: var(--sp-3) !important;
    bottom: var(--sp-3) !important;
    top: auto !important;
    transform: none !important;
    width: auto;
    max-width: none;
    max-height: min(45vh, 100%);
    overflow-y: auto;
  }
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BP;
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createSpotlight({ t = (k) => k } = {}) {
  const doc = typeof document !== 'undefined' ? document : null;

  let overlay = null;     // the fixed scrim host
  let svg = null;         // mask svg
  let maskRect = null;    // the "hole" rect in the mask
  let ringRect = null;    // the breathing hairline around the cutout
  let callout = null;     // current callout panel
  let liveRegion = null;  // aria-live announcer
  let ringArc = null;     // countdown arc path
  let cbs = {};           // engine callbacks (scrim/freeze/esc)
  let currentTarget = null;
  let currentPad = 8;
  let currentPlacement = 'auto';
  let trapHandler = null;
  let keyHandler = null;

  // ----- overlay lifecycle -------------------------------------------------
  function open(opts = {}) {
    if (!doc) return;
    ensureStyles(doc);
    cbs = opts || {};
    if (!overlay) buildOverlay();
    overlay.style.display = 'block';
    installKeyboard();
  }

  function buildOverlay() {
    overlay = doc.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'tour-mask');
    svg.setAttribute('preserveAspectRatio', 'none');

    const defs = doc.createElementNS(NS, 'defs');
    const mask = doc.createElementNS(NS, 'mask');
    mask.setAttribute('id', 'tour-mask-cut');
    // white = shown scrim, black = hole.
    const full = doc.createElementNS(NS, 'rect');
    full.setAttribute('x', '0'); full.setAttribute('y', '0');
    full.setAttribute('width', '100%'); full.setAttribute('height', '100%');
    full.setAttribute('fill', 'white');
    maskRect = doc.createElementNS(NS, 'rect');
    maskRect.setAttribute('fill', 'black');
    maskRect.setAttribute('rx', '4'); // --r-card rounded corners
    maskRect.setAttribute('width', '0');
    maskRect.setAttribute('height', '0');
    mask.appendChild(full);
    mask.appendChild(maskRect);
    defs.appendChild(mask);
    svg.appendChild(defs);

    const scrim = doc.createElementNS(NS, 'rect');
    scrim.setAttribute('class', 'tour-scrim-fill');
    scrim.setAttribute('x', '0'); scrim.setAttribute('y', '0');
    scrim.setAttribute('width', '100%'); scrim.setAttribute('height', '100%');
    scrim.setAttribute('mask', 'url(#tour-mask-cut)');
    svg.appendChild(scrim);

    ringRect = doc.createElementNS(NS, 'rect');
    ringRect.setAttribute('class', 'tour-cutout-ring');
    ringRect.setAttribute('rx', '4');
    ringRect.setAttribute('width', '0');
    ringRect.setAttribute('height', '0');
    svg.appendChild(ringRect);

    overlay.appendChild(svg);

    // aria-live announcer (polite) for step title + body.
    liveRegion = doc.createElement('div');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    // visually hidden but present for AT.
    liveRegion.style.cssText =
      'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);';
    overlay.appendChild(liveRegion);

    // scrim click → engine (manual advance). Clicks on the callout don't bubble
    // here (the callout is a sibling, stopPropagation guards anyway).
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay || (svg && svg.contains(e.target))) {
        if (typeof cbs.onScrimClick === 'function') cbs.onScrimClick();
      }
    });

    doc.body.appendChild(overlay);
  }

  function installKeyboard() {
    if (keyHandler) return;
    keyHandler = (e) => {
      // F4: if a dialog is open, it owns Esc + the focus trap — stand down.
      if (doc.querySelector('.dialog-backdrop')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (typeof cbs.onEsc === 'function') cbs.onEsc();
      }
    };
    doc.addEventListener('keydown', keyHandler, true);
  }

  // focus trap inside the callout (suspended while a dialog is present — F4).
  function installTrap() {
    removeTrap();
    if (!callout) return;
    trapHandler = (e) => {
      if (doc.querySelector('.dialog-backdrop')) return; // F4: dialog owns focus
      if (!callout) return;
      if (e.key !== 'Tab') return;
      const list = Array.from(callout.querySelectorAll(FOCUSABLE))
        .filter((n) => n.offsetParent !== null);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = doc.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      } else if (!callout.contains(active)) {
        e.preventDefault(); first.focus();
      }
    };
    doc.addEventListener('keydown', trapHandler, true);
  }

  function removeTrap() {
    if (trapHandler) {
      doc.removeEventListener('keydown', trapHandler, true);
      trapHandler = null;
    }
  }

  function close() {
    clearCallout(true);
    currentTarget = null;
    if (overlay) overlay.style.display = 'none';
    if (keyHandler) {
      doc.removeEventListener('keydown', keyHandler, true);
      keyHandler = null;
    }
    removeTrap();
  }

  function destroy() {
    close();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null; svg = null; maskRect = null; ringRect = null;
    liveRegion = null;
  }

  // ----- callout construction ----------------------------------------------
  function clearCallout(immediate) {
    removeTrap();
    ringArc = null;
    const el = callout;
    callout = null;
    if (!el) return;
    if (immediate || prefersReducedMotion()) {
      if (el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    el.classList.add('is-leaving');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }

  function makeButton(label, onClick, extraClass) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `btn btn-ghost tour-btn ${extraClass || ''}`.trim();
    b.textContent = label;
    b.setAttribute('aria-label', label);
    if (typeof onClick === 'function') b.addEventListener('click', onClick);
    return b;
  }

  // Build the shared body (title + body + footer with counter/controls).
  function buildCallout(vm, { centered = false } = {}) {
    clearCallout(true);
    const el = doc.createElement('div');
    el.className = `tour-callout panel${centered ? ' is-centered' : ''}`;
    el.setAttribute('role', 'document');

    const title = doc.createElement('span');
    title.className = 'label tour-title';
    title.textContent = vm.copy ? vm.copy.title : (vm.title || '');
    el.appendChild(title);

    if (vm.copy && vm.copy.body) {
      const body = doc.createElement('p');
      body.className = 'tour-body';
      body.textContent = vm.copy.body;
      el.appendChild(body);
    }

    callout = el;
    overlay.appendChild(el);
    announce(title.textContent, vm.copy ? vm.copy.body : '');
    return el;
  }

  function buildFooter(vm) {
    const footer = doc.createElement('div');
    footer.className = 'tour-footer';

    const counter = doc.createElement('span');
    counter.className = 'tour-counter';
    counter.textContent = vm.ui.stepLabel;
    footer.appendChild(counter);

    const controls = doc.createElement('div');
    controls.className = 'tour-controls';

    // auto-mode countdown ring (reduced-motion → no ring; dwell highlight).
    if (vm.mode === 'auto' && !vm.reducedMotion) {
      controls.appendChild(buildRing());
    } else if (vm.mode === 'auto' && vm.reducedMotion) {
      callout.classList.add('is-dwell');
    }

    if (!vm.isFirst) {
      controls.appendChild(makeButton(vm.ui.prev, vm.handlers.onPrev));
    }
    controls.appendChild(makeButton(vm.ui.skip, vm.handlers.onSkip));
    const nextLabel = vm.isLast ? vm.ui.done : vm.ui.next;
    controls.appendChild(makeButton(nextLabel, vm.handlers.onNext, 'tour-next'));

    footer.appendChild(controls);
    callout.appendChild(footer);

    // freeze the auto countdown while the callout is hovered/focused (DS-8).
    if (vm.mode === 'auto') {
      callout.addEventListener('mouseenter', () => fire('onFreeze'));
      callout.addEventListener('mouseleave', () => fire('onUnfreeze'));
      callout.addEventListener('focusin', () => fire('onFreeze'));
      callout.addEventListener('focusout', () => fire('onUnfreeze'));
    }
  }

  function fire(name) {
    if (typeof cbs[name] === 'function') cbs[name]();
  }

  function buildRing() {
    const r = (RING_DIAMETER - RING_STROKE) / 2;
    const c = RING_DIAMETER / 2;
    const ns = doc.createElementNS(NS, 'svg');
    ns.setAttribute('class', 'tour-ring');
    ns.setAttribute('viewBox', `0 0 ${RING_DIAMETER} ${RING_DIAMETER}`);
    ns.setAttribute('aria-hidden', 'true');
    const track = doc.createElementNS(NS, 'circle');
    track.setAttribute('class', 'tour-ring-track');
    track.setAttribute('cx', c); track.setAttribute('cy', c); track.setAttribute('r', r);
    const arc = doc.createElementNS(NS, 'circle');
    arc.setAttribute('class', 'tour-ring-arc');
    arc.setAttribute('cx', c); arc.setAttribute('cy', c); arc.setAttribute('r', r);
    const circ = 2 * Math.PI * r;
    arc.setAttribute('stroke-dasharray', String(circ));
    arc.setAttribute('stroke-dashoffset', '0');
    arc._circ = circ;
    ns.appendChild(track);
    ns.appendChild(arc);
    ringArc = arc;
    return ns;
  }

  // engine calls this each auto-tick with (ticksLeft, total) → fill the arc.
  function setCountdown(ticksLeft, total) {
    if (!ringArc) return;
    const frac = Math.max(0, Math.min(1, 1 - ticksLeft / total));
    ringArc.setAttribute('stroke-dashoffset', String(ringArc._circ * (1 - frac)));
  }

  function announce(title, body) {
    if (!liveRegion) return;
    liveRegion.textContent = `${title || ''}. ${body || ''}`.trim();
  }

  // ----- the per-step view entry points ------------------------------------
  function showAnchored(vm) {
    currentTarget = vm.anchor;
    currentPad = vm.pad;
    currentPlacement = vm.placement;
    scrollIntoView(vm.anchor);
    buildCallout(vm);
    buildFooter(vm);
    positionAroundTarget();
    installTrap();
    focusFirst();
  }

  function showCentered(vm) {
    currentTarget = null;
    hideCutout();
    buildCallout(vm, { centered: true });
    buildFooter(vm);
    centerInContent();
    installTrap();
    focusFirst();
  }

  function showDesktopOnly(vm) {
    currentTarget = null;
    hideCutout();
    const el = buildCallout(vm, { centered: true });
    // DS-13 signature: desktop glyph + note, visually distinct from a degrade.
    const note = doc.createElement('p');
    note.className = 'tour-note';
    const glyph = doc.createElement('span');
    glyph.className = 'tour-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = '🖥';
    el.insertBefore(glyph, el.querySelector('.tour-body') || null);
    note.textContent = vm.ui.desktopOnlyNote;
    el.appendChild(note);
    buildFooter(vm);
    centerInContent();
    installTrap();
    focusFirst();
  }

  function showFinal(vm) {
    currentTarget = null;
    hideCutout();
    const el = buildCallout(vm, { centered: true });
    const actions = doc.createElement('div');
    actions.className = 'tour-actions';
    for (const a of (vm.actions || [])) {
      const cls = a.id === 'explore' ? 'btn-primary' : '';
      actions.appendChild(makeButton(a.label, a.onClick, cls));
    }
    el.appendChild(actions);
    centerInContent();
    installTrap();
    // focus the first action.
    const first = actions.querySelector('button');
    if (first) first.focus();
  }

  // DS-3 transition card — skeleton shimmer, no controls, no cutout retained.
  function showTransition(vm) {
    hideCutout();
    clearCallout(true);
    const el = doc.createElement('div');
    el.className = 'tour-callout panel is-centered tour-transition';
    const title = doc.createElement('span');
    title.className = 'label tour-title';
    title.textContent = vm.title || '';
    el.appendChild(title);
    const sk = doc.createElement('div');
    sk.className = 'tour-skeleton';
    const b1 = doc.createElement('div'); b1.className = 'tour-skeleton-bar';
    const b2 = doc.createElement('div'); b2.className = 'tour-skeleton-bar is-short';
    sk.appendChild(b1); sk.appendChild(b2);
    el.appendChild(sk);
    callout = el;
    overlay.appendChild(el);
    centerInContent();
    announce(title.textContent, '');
  }

  // Center the current callout over #content (rail-aware) using explicit pixel
  // top-left + transform:none. We avoid the CSS `.is-centered { translate(-50%) }`
  // path because the tour-callout-in animation (fill-mode:both) leaves a
  // `transform: translateY(0)` that beats the author translate, leaving the
  // card's TOP-LEFT — not its center — at the content centre (B2). Mobile keeps
  // the CSS bottom-sheet (its !important rules win regardless).
  function centerInContent() {
    if (!callout || isMobile()) return;
    const content = doc.getElementById('content');
    const region = content
      ? content.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const cw = callout.offsetWidth || 320;
    const ch = callout.offsetHeight || 160;
    let left = region.left + (region.width - cw) / 2;
    let top = region.top + (region.height - ch) / 2;
    // clamp inside the viewport so a tall card never escapes off-screen.
    const gap = 12;
    left = Math.max(gap, Math.min(left, window.innerWidth - cw - gap));
    top = Math.max(gap, Math.min(top, window.innerHeight - ch - gap));
    callout.style.left = `${left}px`;
    callout.style.top = `${top}px`;
    callout.style.transform = 'none';
  }

  function focusFirst() {
    if (!callout) return;
    const f = callout.querySelector(FOCUSABLE);
    if (f && !doc.querySelector('.dialog-backdrop')) f.focus();
  }

  // ----- geometry ----------------------------------------------------------
  function rectFor(target, pad) {
    const r = target.getBoundingClientRect();
    return {
      x: Math.max(0, r.left - pad),
      y: Math.max(0, r.top - pad),
      w: r.width + pad * 2,
      h: r.height + pad * 2,
    };
  }

  function applyCutout(box) {
    if (!maskRect || !ringRect) return;
    maskRect.setAttribute('x', String(box.x));
    maskRect.setAttribute('y', String(box.y));
    maskRect.setAttribute('width', String(box.w));
    maskRect.setAttribute('height', String(box.h));
    ringRect.setAttribute('x', String(box.x));
    ringRect.setAttribute('y', String(box.y));
    ringRect.setAttribute('width', String(box.w));
    ringRect.setAttribute('height', String(box.h));
  }

  function hideCutout() {
    if (maskRect) { maskRect.setAttribute('width', '0'); maskRect.setAttribute('height', '0'); }
    if (ringRect) { ringRect.setAttribute('width', '0'); ringRect.setAttribute('height', '0'); }
  }

  function positionAroundTarget() {
    if (!currentTarget || !callout) return;
    const box = rectFor(currentTarget, currentPad);
    applyCutout(box);
    if (isMobile()) return; // CSS bottom-sheet owns mobile placement.

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = callout.offsetWidth || 320;
    const ch = callout.offsetHeight || 160;
    const gap = 12;

    // room on each side of the cutout.
    const room = {
      right: vw - (box.x + box.w),
      left: box.x,
      bottom: vh - (box.y + box.h),
      top: box.y,
    };
    const order = currentPlacement && currentPlacement !== 'auto'
      ? [currentPlacement, 'right', 'left', 'bottom', 'top']
      : ['right', 'left', 'bottom', 'top'];
    // pick the first side that fits, else the side with the most room.
    let side = order.find((s) =>
      (s === 'right' && room.right >= cw + gap)
      || (s === 'left' && room.left >= cw + gap)
      || (s === 'bottom' && room.bottom >= ch + gap)
      || (s === 'top' && room.top >= ch + gap));
    if (!side) {
      side = Object.keys(room).reduce((a, b) => (room[a] >= room[b] ? a : b));
    }

    let left; let top;
    if (side === 'right') { left = box.x + box.w + gap; top = box.y; }
    else if (side === 'left') { left = box.x - cw - gap; top = box.y; }
    else if (side === 'bottom') { left = box.x; top = box.y + box.h + gap; }
    else { left = box.x; top = box.y - ch - gap; }

    // clamp inside the viewport.
    left = Math.max(gap, Math.min(left, vw - cw - gap));
    top = Math.max(gap, Math.min(top, vh - ch - gap));

    callout.style.left = `${left}px`;
    callout.style.top = `${top}px`;
    callout.style.transform = 'none';
  }

  function scrollIntoView(target) {
    if (!target || typeof target.scrollIntoView !== 'function') return;
    const reduce = prefersReducedMotion();
    // mobile: bring the target into the upper 50vh so it clears the sheet.
    target.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: isMobile() ? 'start' : 'nearest',
      inline: 'nearest',
    });
  }

  // ----- reposition (engine rAF loop drives this) --------------------------
  // track(el): the engine re-resolves the anchor each frame and hands us the
  // live node (or null → it degraded; we keep the last cutout hidden).
  function track(el) {
    if (!el) return;
    currentTarget = el;
    positionAroundTarget();
  }

  function reposition() {
    if (currentTarget) positionAroundTarget();
  }

  return {
    open,
    close,
    destroy,
    showAnchored,
    showCentered,
    showDesktopOnly,
    showFinal,
    showTransition,
    setCountdown,
    track,
    reposition,
  };
}

export default createSpotlight;
