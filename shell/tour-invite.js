// shell/tour-invite.js — first-visit guided-tour invite (M3, DS-2 + F10).
//
// A small NON-BLOCKING coach-mark (panel vocabulary, NO scrim, NO modal) that
// invites a first-time visitor to take the 30-second onboarding tour. It never
// hijacks the first impression: it waits for the hero story to finish (or, if the
// hero will not autoplay this load, a plain timeout fallback) before appearing,
// and it retires the instant the visitor does anything else.
//
// Placement (DS-2 / F10):
//   ≥768  — fixed coach-mark anchored next to the ? button in the nav rail,
//           computed from the button's rect and re-anchored on resize.
//   <768  — full-width bottom-sheet (the rail is a bottom bar; we do NOT anchor
//           to the ? button there), max-height 30vh.
//
// Timing: shown ONLY when first-visit (!dismissed && no completion && no lastStep)
// AND not started via ?tour= deep-link AND no tour is active. Armed on boot; the
// actual reveal waits for the `hero:finished` document event, with a ~45s timeout
// fallback for reduced-motion / replay loads where the hero won't autoplay.
//
// Retire semantics:
//   • [Start]  → start onboarding (manual), fade (does NOT persist dismissed).
//   • [Skip] / dismiss button → persist dismissed via the engine, fade.
//   • Esc      → dismiss-for-session only (fade, NOT persisted).
//   • any module:change OR guide:open (hub) → fade (NOT persisted).
//
// All copy via t(key); all text via textContent (F11). Token-only injected CSS
// (the established shell/spotlight pattern); --z-invite seats it just above the
// tooltip layer and far below the tour overlay (they never coexist).

const STYLE_ID = 'tour-invite-styles';
const MOBILE_BP = 768;
const HERO_FALLBACK_MS = 45000; // ~45s: hero won't autoplay (reduced-motion/replay)

// Layout-only stylesheet; every value is a token. --z-invite is defined inline
// here off the existing ladder (tooltip 110 < invite < tour-overlay 9000) so the
// non-modal card clears the rail tooltips but never fights a running tour.
const CSS = `
.tour-invite {
  position: fixed;
  z-index: 200;
  box-sizing: border-box;
  width: max-content;
  max-width: 320px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--hairline);
  border-radius: var(--r-card);
  box-shadow: var(--sh-lg);
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.tour-invite .tour-invite-title { display: block; color: var(--accent); }
.tour-invite .tour-invite-body {
  font-size: var(--fs-body);
  color: var(--text-primary);
  line-height: 1.5;
  margin: 0;
}
.tour-invite .tour-invite-actions {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}
.tour-invite .tour-invite-actions .btn { min-height: 44px; }

/* <768: full-width bottom-sheet (rail is a bottom bar; do not anchor to ?). */
@media (max-width: ${MOBILE_BP - 1}px) {
  .tour-invite {
    left: var(--sp-3) !important;
    right: var(--sp-3) !important;
    bottom: var(--sp-3) !important;
    top: auto !important;
    width: auto;
    max-width: none;
    max-height: 30vh;
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

export function createTourInvite({
  tourEngine,
  t = (k) => k,
  deepLinkActive = false,   // true when ?tour= started a tour at boot (never show)
} = {}) {
  const doc = typeof document !== 'undefined' ? document : null;

  let card = null;
  let armed = false;
  let shown = false;
  let retired = false;
  let fallbackTimer = null;
  let onHeroFinished = null;
  let onReveal = null;       // module:change / guide:open retire listener
  let onTourStarted = null;  // tour:started retire listener (B1)
  let onResize = null;
  let onKey = null;

  // first-visit gate: no dismissal, no completion, no saved step.
  function isFirstVisit() {
    const s = tourEngine.state();
    if (s.dismissed) return false;
    if (s.lastStep) return false;
    const completed = s.completed || {};
    return Object.keys(completed).every((k) => !completed[k]);
  }

  // --- anchoring (≥768): park beside the ? button -------------------------
  function positionByHelpButton() {
    if (!card || isMobile()) return; // CSS owns the bottom-sheet placement.
    const btn = doc.querySelector('[data-tour="shell.help"]');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const cw = card.offsetWidth || 280;
    const ch = card.offsetHeight || 120;
    const gap = 12;
    // prefer to the RIGHT of the rail button; clamp inside the viewport.
    let left = r.right + gap;
    let top = r.top;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left + cw + gap > vw) left = Math.max(gap, r.left - cw - gap);
    top = Math.max(gap, Math.min(top, vh - ch - gap));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  // --- build + reveal ------------------------------------------------------
  function reveal() {
    if (retired || shown || !doc) return;
    // re-check the live preconditions at reveal time (state may have changed).
    if (deepLinkActive) { retire(false); return; }
    if (tourEngine.state().active) { retire(false); return; }
    if (doc.querySelector('.dialog-backdrop')) { retire(false); return; }
    if (!isFirstVisit()) { retire(false); return; }

    ensureStyles(doc);
    shown = true;

    card = doc.createElement('div');
    card.className = 'tour-invite panel';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', t('tour.ui.invite.title'));

    const title = doc.createElement('span');
    title.className = 'label tour-invite-title';
    title.textContent = t('tour.ui.invite.title');
    card.appendChild(title);

    const body = doc.createElement('p');
    body.className = 'tour-invite-body';
    body.textContent = t('tour.ui.invite.body');
    card.appendChild(body);

    const actions = doc.createElement('div');
    actions.className = 'tour-invite-actions';
    const start = makeButton(t('tour.ui.invite.start'), () => {
      retire(false);                 // starting a tour does NOT persist dismissed
      tourEngine.start('onboarding', { mode: 'manual' });
    }, 'btn-primary');
    const skip = makeButton(t('tour.ui.invite.dismiss'), () => retire(true));
    actions.appendChild(start);
    actions.appendChild(skip);
    card.appendChild(actions);

    doc.body.appendChild(card);
    positionByHelpButton();

    onResize = () => positionByHelpButton();
    window.addEventListener('resize', onResize);

    // Esc dismisses for the session only (fade, not persisted).
    onKey = (e) => { if (e.key === 'Escape') retire(false); };
    doc.addEventListener('keydown', onKey, true);

    // move focus to the primary action for keyboard users.
    start.focus();
  }

  function makeButton(label, onClick, variant) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `btn${variant ? ' ' + variant : ''}`;
    b.textContent = label;
    b.setAttribute('aria-label', label);
    if (typeof onClick === 'function') b.addEventListener('click', onClick);
    return b;
  }

  // retire(persist): remove the card + all listeners. persist=true → mark dismissed.
  function retire(persist) {
    if (retired) {
      if (persist && typeof tourEngine.dismiss === 'function') tourEngine.dismiss();
      return;
    }
    retired = true;
    if (persist && typeof tourEngine.dismiss === 'function') tourEngine.dismiss();

    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    if (onHeroFinished) { doc.removeEventListener('hero:finished', onHeroFinished); onHeroFinished = null; }
    if (onReveal) {
      window.removeEventListener('module:change', onReveal);
      doc.removeEventListener('guide:open', onReveal);
      onReveal = null;
    }
    if (onTourStarted) {
      doc.removeEventListener('tour:started', onTourStarted);
      onTourStarted = null;
    }
    if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
    if (onKey) { doc.removeEventListener('keydown', onKey, true); onKey = null; }

    const el = card;
    card = null;
    if (!el) return;
    if (prefersReducedMotion()) {
      if (el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    el.style.transition = `opacity var(--transition) var(--ease-instrument)`;
    el.style.opacity = '0';
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }

  // arm(): wire the reveal triggers. No-op when not a first visit / deep-linked.
  function arm() {
    if (armed || !doc) return;
    armed = true;
    if (deepLinkActive || !isFirstVisit()) { retired = true; return; }

    // retire (without persisting) on any genuine interaction or the hub opening.
    onReveal = () => retire(false);
    window.addEventListener('module:change', onReveal);
    doc.addEventListener('guide:open', onReveal);

    // B1: any tour starting (deep-link, ?tour=, __SIM.startTour, the invite's own
    // Start button) retires the invite up-front. The engine dispatches this BEFORE
    // its hero mutex, so even a synchronous hero:finished → reveal() that follows
    // finds an already-retired card and no-ops. This is the authoritative guard;
    // reveal()'s state().active re-check is the belt-and-braces backup.
    onTourStarted = () => retire(false);
    doc.addEventListener('tour:started', onTourStarted);

    // reveal after the hero story finishes (DS-2: hero owns the first wow).
    onHeroFinished = () => reveal();
    doc.addEventListener('hero:finished', onHeroFinished);

    // fallback: if the hero never autoplays (reduced-motion / replay load), the
    // `hero:finished` event won't fire — reveal anyway after ~45s.
    fallbackTimer = setTimeout(() => { if (!shown) reveal(); }, HERO_FALLBACK_MS);
  }

  function destroy() { retire(false); armed = false; }

  return { arm, retire, destroy };
}

export default createTourInvite;
