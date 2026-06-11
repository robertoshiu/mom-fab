// shell/guide-hub.js — Guide Hub dialog (M3).
//
// The guided-tour system's manual entry point: a modal (components/dialog.js, at
// --z-dialog 9500 so it opens ABOVE a paused tour — DS-5) with two tabs:
//   • Tours — all 11 tours from scenarios/tours.js, each row a LED (● done /
//     ○ not, colour + shape dual-coded), title, estimate, and a Start button.
//     A tour with a saved lastStep also offers a Resume affordance. Footer: a
//     reset-progress button + a kiosk "auto-play everything" row.
//   • How this works — the 7 guide.how.N sections as an engraved-label + body list.
//
// Factory style matching the other shell components: createGuideHub(deps) → a
// handle with .open()/.close(). Opens on the document `guide:open` CustomEvent
// (dispatched by the nav ? button and by the tour engine's final-card [openHub]
// action). ALL copy via t(key); ALL text via textContent (F11). dialog.js owns
// the focus trap + Esc; the tour engine suspends its own while a .dialog-backdrop
// exists, so the hub Esc only closes the hub (F4). Locale change re-renders the
// open hub in place.
//
// Styling: layout-only CSS injected once (the established shell/spotlight pattern);
// every value is a token — only the LED ○/● glyphs are literal characters.

import { Dialog } from '../components/dialog.js';
import { tours, tourIds } from '../scenarios/tours.js';

const STYLE_ID = 'guide-hub-styles';

// Tabs the hub exposes (id → i18n key for the tab label).
const TABS = [
  { id: 'tours', key: 'guide.tab.tours' },
  { id: 'how', key: 'guide.tab.how' },
];
const HOW_SECTIONS = [1, 2, 3, 4, 5, 6, 7];

// Layout-only stylesheet; every value is a token (the ●/○ LED glyphs and the
// hairline LED ring are the only non-token primitives — dual-coding + hairline,
// both iron-rule exempt).
const CSS = `
.guide-tabs {
  display: flex;
  gap: var(--sp-2);
  border-bottom: 1px solid var(--hairline);
  margin-bottom: var(--sp-4);
}
.guide-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font: var(--fw-emphasis) var(--fs-caption) var(--font-body);
  letter-spacing: var(--label-tracking);
  text-transform: uppercase;
  padding: var(--sp-2) var(--sp-2);
  min-height: 44px;
  cursor: pointer;
}
.guide-tab[aria-selected="true"] {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.guide-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.guide-panel { max-height: 60vh; overflow-y: auto; }

.guide-tour-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--hairline);
}
.guide-tour-led {
  flex: none;
  width: 1em;
  text-align: center;
  font-family: var(--font-mono);
  line-height: 1;
}
.guide-tour-led.is-done { color: var(--success); }
.guide-tour-led.is-todo { color: var(--text-secondary); }
.guide-tour-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-right: auto;
  min-width: 0;
}
.guide-tour-title { color: var(--text-primary); }
.guide-tour-est {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.guide-tour-actions {
  display: flex;
  gap: var(--sp-2);
  flex: none;
}
.guide-tour-actions .btn { min-height: 44px; }

.guide-footer {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin-top: var(--sp-4);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--hairline);
}
.guide-kiosk {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.guide-kiosk-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-right: auto;
  min-width: 0;
}
.guide-kiosk-body { font-size: var(--fs-caption); color: var(--text-secondary); }
.guide-kiosk .btn,
.guide-reset { min-height: 44px; }
.guide-reset { align-self: flex-start; }

.guide-how-item { padding: var(--sp-2) 0; border-bottom: 1px solid var(--hairline); }
.guide-how-item:last-child { border-bottom: none; }
.guide-how-body {
  font-size: var(--fs-body);
  color: var(--text-primary);
  line-height: 1.55;
  margin: var(--sp-1) 0 0;
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

export function createGuideHub({ tourEngine, t = (k) => k, onLocaleChange } = {}) {
  const doc = typeof document !== 'undefined' ? document : null;
  let handle = null;     // the live Dialog() handle, or null when closed
  let activeTab = 'tours';
  let unsubLocale = null;

  // --- one button factory (token .btn vocabulary) --------------------------
  function makeButton(label, onClick, variant) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `btn${variant ? ' ' + variant : ''}`;
    b.textContent = label;
    b.setAttribute('aria-label', label);
    if (typeof onClick === 'function') b.addEventListener('click', onClick);
    return b;
  }

  // --- Tours tab -----------------------------------------------------------
  function buildToursPanel() {
    const panel = doc.createElement('div');
    panel.className = 'guide-panel';
    panel.id = 'guide-panel-tours';
    panel.setAttribute('role', 'tabpanel');

    const snap = tourEngine.state();
    const completed = snap.completed || {};
    const last = snap.lastStep || null;

    for (const id of tourIds) {
      const tour = tours.find((tr) => tr.id === id);
      if (!tour) continue;
      const done = !!completed[id];

      const row = doc.createElement('div');
      row.className = 'guide-tour-row';

      // LED: colour + shape dual-coded (● done / ○ not) per DESIGN.md led vocabulary.
      const led = doc.createElement('span');
      led.className = `guide-tour-led ${done ? 'is-done' : 'is-todo'}`;
      led.setAttribute('aria-hidden', 'true');
      led.textContent = done ? '●' : '○';
      row.appendChild(led);

      const main = doc.createElement('div');
      main.className = 'guide-tour-main';
      const title = doc.createElement('span');
      title.className = 'guide-tour-title';
      title.textContent = t(`tour.${id}.title`);
      const est = doc.createElement('span');
      est.className = 'guide-tour-est';
      est.textContent = `~${tour.estimate || 30}s`;
      main.appendChild(title);
      main.appendChild(est);
      row.appendChild(main);

      const actions = doc.createElement('div');
      actions.className = 'guide-tour-actions';
      // Resume affordance: only when a saved lastStep belongs to THIS tour.
      if (last && last.tourId === id && typeof last.stepIndex === 'number') {
        actions.appendChild(makeButton(t('guide.resume'), () => {
          close();
          tourEngine.start(id, { stepIndex: last.stepIndex, mode: 'manual' });
        }));
      }
      // accessible state on the Start button (the LED is aria-hidden).
      const startBtn = makeButton(t('guide.start'), () => {
        close();
        tourEngine.start(id, { mode: 'manual' });
      }, 'btn-primary');
      startBtn.setAttribute(
        'aria-label',
        `${t('guide.start')} — ${t(`tour.${id}.title`)} (${done ? t('guide.done') : t('guide.notDone')})`,
      );
      actions.appendChild(startBtn);
      row.appendChild(actions);

      panel.appendChild(row);
    }

    panel.appendChild(buildFooter());
    return panel;
  }

  function buildFooter() {
    const footer = doc.createElement('div');
    footer.className = 'guide-footer';

    // kiosk: auto-play onboarding, then auto-chain into grand-tour, hands-free.
    const kiosk = doc.createElement('div');
    kiosk.className = 'guide-kiosk';
    const kMain = doc.createElement('div');
    kMain.className = 'guide-kiosk-main';
    const kTitle = doc.createElement('span');
    kTitle.className = 'label';
    kTitle.textContent = t('guide.kiosk.title');
    const kBody = doc.createElement('span');
    kBody.className = 'guide-kiosk-body';
    kBody.textContent = t('guide.kiosk.body');
    kMain.appendChild(kTitle);
    kMain.appendChild(kBody);
    kiosk.appendChild(kMain);
    kiosk.appendChild(makeButton(t('guide.kiosk.start'), startKiosk));
    footer.appendChild(kiosk);

    // reset progress: clear completion / dismissed / lastStep, then re-render.
    const reset = makeButton(t('guide.reset'), () => {
      if (typeof tourEngine.resetProgress === 'function') {
        tourEngine.resetProgress();
      } else {
        try { localStorage.removeItem('momfab.tour.v1'); } catch (_) { /* private mode */ }
      }
      render(); // reflect the cleared LEDs immediately
    });
    reset.classList.add('guide-reset');
    footer.appendChild(reset);

    return footer;
  }

  // Kiosk: start onboarding in auto mode, then auto-start grand-tour in auto when
  // onboarding completes. Explicit state polling (no hidden engine callback): once
  // onboarding is no longer active we hand off to grand-tour exactly once.
  function startKiosk() {
    close();
    const started = tourEngine.start('onboarding', { mode: 'auto' });
    if (!started) return;
    if (!tourIds.includes('grand-tour')) return;
    let chained = false;
    const poll = () => {
      const s = tourEngine.state();
      // onboarding finished cleanly (not interrupted) → chain the grand tour.
      if (!chained && !s.active && (s.completed || {}).onboarding && !s.lastStep) {
        chained = true;
        tourEngine.start('grand-tour', { mode: 'auto' });
        return;
      }
      // stop polling once any tour is no longer the onboarding auto-run we launched
      // (interrupted by the user, or grand-tour handoff done).
      if (chained) return;
      if (!s.active && (s.lastStep || (!((s.completed || {}).onboarding)))) return;
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  // --- How tab -------------------------------------------------------------
  function buildHowPanel() {
    const panel = doc.createElement('div');
    panel.className = 'guide-panel';
    panel.id = 'guide-panel-how';
    panel.setAttribute('role', 'tabpanel');
    for (const n of HOW_SECTIONS) {
      const item = doc.createElement('div');
      item.className = 'guide-how-item';
      const title = doc.createElement('span');
      title.className = 'label';
      title.textContent = t(`guide.how.${n}.title`);
      const body = doc.createElement('p');
      body.className = 'guide-how-body';
      body.textContent = t(`guide.how.${n}.body`);
      item.appendChild(title);
      item.appendChild(body);
      panel.appendChild(item);
    }
    return panel;
  }

  // --- the dialog body (tabs + active panel) -------------------------------
  function buildBody() {
    const wrap = doc.createElement('div');

    const tablist = doc.createElement('div');
    tablist.className = 'guide-tabs';
    tablist.setAttribute('role', 'tablist');
    for (const tab of TABS) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'guide-tab';
      btn.setAttribute('role', 'tab');
      btn.id = `guide-tab-${tab.id}`;
      btn.setAttribute('aria-selected', String(tab.id === activeTab));
      btn.setAttribute('aria-controls', `guide-panel-${tab.id}`);
      btn.textContent = t(tab.key);
      btn.addEventListener('click', () => {
        if (activeTab === tab.id) return;
        activeTab = tab.id;
        render();
      });
      tablist.appendChild(btn);
    }
    wrap.appendChild(tablist);

    wrap.appendChild(activeTab === 'how' ? buildHowPanel() : buildToursPanel());
    return wrap;
  }

  // --- open / render / close ------------------------------------------------
  function render() {
    if (!handle) return;
    // re-render in place: swap the dialog's body content, keep the same backdrop.
    const bodyWrap = handle.dialog.querySelector('.panel-body');
    if (!bodyWrap) return;
    while (bodyWrap.firstChild) bodyWrap.removeChild(bodyWrap.firstChild);
    bodyWrap.appendChild(buildBody());
  }

  function open() {
    if (!doc || handle) return;
    ensureStyles(doc);
    activeTab = 'tours';
    handle = Dialog({
      titleI18nKey: 'guide.title',
      body: buildBody(),
      onClose: () => { handle = null; },
    });
    // locale change → re-render the open hub (tabs + rows redraw via t()).
    if (typeof onLocaleChange === 'function' && !unsubLocale) {
      unsubLocale = onLocaleChange(() => { if (handle) render(); });
    }
  }

  function close() {
    if (handle) handle.close(); // onClose nulls the handle
  }

  // open on the document-level guide:open event (nav ? button + engine final card).
  function onGuideOpen() { open(); }
  if (doc) doc.addEventListener('guide:open', onGuideOpen);

  function destroy() {
    close();
    if (doc) doc.removeEventListener('guide:open', onGuideOpen);
    if (unsubLocale) { unsubLocale(); unsubLocale = null; }
  }

  return { open, close, destroy };
}

export default createGuideHub;
