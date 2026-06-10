// shell/nav.js — left module navigation rail (T10).
// 9 module buttons on the 72px rail: icon (assets/icons.svg sprite via <use>)
// + ABBREVIATION + keyboard shortcut (1-9). Hover AND keyboard focus reveal a
// tooltip with the bilingual full name (i18n nav.{id}.full). Click sets .active
// and dispatches the module:change CustomEvent (the T13 router listens). Bottom
// of the rail: theme toggle (THE single runtime writer of data-theme, 7A),
// locale toggle (calls i18n setLocale), and a disabled ▶ demo placeholder.
//
// Rendering ownership (2B): state (the active id) mutates first, then we do an
// idempotent DOM patch. Labels/tooltips re-read t() on every render and re-run
// on locale change (7A/6A) — translations are never cached.

import { t, getLocale, setLocale, onLocaleChange } from '../i18n/index.js';

// Module manifest: id (data-module + i18n key segment) → sprite symbol id.
// Order is the 1-9 keyboard-shortcut order.
const MODULES = [
  { id: 'mes', icon: 'i-mes' },
  { id: 'aps', icon: 'i-aps' },
  { id: 'erp', icon: 'i-erp' },
  { id: 'spc', icon: 'i-spc' },
  { id: 'apc', icon: 'i-apc' },
  { id: 'wip', icon: 'i-wip' },
  { id: 'scm', icon: 'i-scm' },
  { id: 'recipe', icon: 'i-recipe' },
  { id: 'yield', icon: 'i-yield' },
];

const ICONS = 'assets/icons.svg';
const COMPONENTS_CSS = 'styles/components.css';

// Ensure the shell-scoped stylesheet is loaded (index.html only links what
// existed at Wave 2 boot; this self-registers components.css once, idempotently).
function ensureStylesheet() {
  if (document.querySelector(`link[href="${COMPONENTS_CSS}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = COMPONENTS_CSS;
  document.head.appendChild(link);
}

// --- module state (state-first; the DOM mirrors this) ---------------------
let activeId = null;
let nav = null;            // the <aside id="nav-left"> host
const buttonsById = new Map();

function useIcon(symbol) {
  // <svg class="icon"><use href="assets/icons.svg#i-NAME"/></svg>
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `${ICONS}#${symbol}`);
  svg.appendChild(use);
  return svg;
}

// Re-read t() and repaint every translatable label/tooltip/title (7A: never
// cache translations — this runs at first render and on every locale change).
function renderLabels() {
  for (const { id } of MODULES) {
    const btn = buttonsById.get(id);
    if (!btn) continue;
    const abbr = t(`nav.${id}`);
    const full = t(`nav.${id}.full`);
    btn.querySelector('.mod-abbr').textContent = abbr;
    btn.querySelector('.tip').textContent = full;
    btn.setAttribute('aria-label', full);
  }
  // rail control buttons
  const themeBtn = nav.querySelector('#nav-theme-toggle');
  const localeBtn = nav.querySelector('#nav-locale-toggle');
  const demoBtn = nav.querySelector('#nav-demo');
  if (themeBtn) {
    const label = t('theme.toggle');
    themeBtn.setAttribute('aria-label', label);
    themeBtn.querySelector('.tip').textContent = label;
  }
  if (localeBtn) {
    const label = t('theme.locale_toggle');
    localeBtn.setAttribute('aria-label', label);
    localeBtn.querySelector('.tip').textContent = label;
    // show the OTHER locale as the affordance text.
    localeBtn.querySelector('.rail-btn-text').textContent =
      getLocale() === 'zh-TW' ? 'EN' : '中';
  }
  if (demoBtn) {
    // T30: the ▶ button is the manual replay trigger for the hero story.
    const label = t('hero.play');
    demoBtn.setAttribute('aria-label', label);
    demoBtn.querySelector('.tip').textContent = label;
  }
}

// idempotent DOM patch: move the .active class + aria-current to the active id.
function paintActive() {
  for (const [id, btn] of buttonsById) {
    const on = id === activeId;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
}

// Public: set the active module (state-first → patch → dispatch). Called by the
// click handler and the keyboard shortcuts; the T13 router also listens to the
// dispatched event. Idempotent: re-selecting the active module is a no-op event.
function setActive(id) {
  if (!buttonsById.has(id)) return;
  const changed = id !== activeId;
  activeId = id;            // state first
  paintActive();            // then the idempotent DOM patch
  if (changed) {
    window.dispatchEvent(new CustomEvent('module:change', { detail: { id } }));
  }
}

// T30: move the rail highlight WITHOUT dispatching module:change. The hero story
// drives module switches through router.set() directly; it calls this to keep the
// rail in sync so its programmatic switches are NOT mistaken for a user interrupt
// (which the story cancels on). State-first → idempotent paint, no event.
function setActiveSilent(id) {
  if (!buttonsById.has(id)) return;
  activeId = id;
  paintActive();
}

function makeTip() {
  const tip = document.createElement('span');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  return tip;
}

function buildModuleButton(mod, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mod boot-seq';
  btn.dataset.module = mod.id;
  btn.style.setProperty('--nav-d', `${40 + index * 40}ms`);
  // accessible keyboard-shortcut hint
  btn.setAttribute('accesskey', String(index + 1));

  btn.appendChild(useIcon(mod.icon));

  const abbr = document.createElement('span');
  abbr.className = 'mod-abbr';
  btn.appendChild(abbr);

  btn.appendChild(makeTip());

  btn.addEventListener('click', () => setActive(mod.id));
  return btn;
}

function buildRailButton({ id, klass, text, iconSymbol, disabled }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = `rail-btn boot-seq${klass ? ' ' + klass : ''}`;
  if (disabled) btn.disabled = true;
  if (iconSymbol) {
    btn.appendChild(useIcon(iconSymbol));
  } else {
    const span = document.createElement('span');
    span.className = 'rail-btn-text';
    span.textContent = text || '';
    btn.appendChild(span);
  }
  btn.appendChild(makeTip());
  return btn;
}

// --- theme toggle: THE single runtime writer of data-theme (7A) -----------
function toggleTheme() {
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
}

function toggleLocale() {
  setLocale(getLocale() === 'zh-TW' ? 'en-US' : 'zh-TW');
}

// --- keyboard shortcuts 1-9 ------------------------------------------------
function onKeydown(e) {
  // ignore when typing into a field or using modifier chords.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      (e.target && e.target.isContentEditable)) return;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= MODULES.length) {
    e.preventDefault();
    setActive(MODULES[n - 1].id);
  }
}

export function initNav(options = {}) {
  nav = document.getElementById('nav-left');
  if (!nav) return null;

  ensureStylesheet();

  // Build the 9 module buttons after the brand-mark slot.
  const frag = document.createDocumentFragment();
  MODULES.forEach((mod, i) => {
    const btn = buildModuleButton(mod, i);
    buttonsById.set(mod.id, btn);
    frag.appendChild(btn);
  });

  // spacer pushes the control buttons to the rail bottom.
  const spacer = document.createElement('div');
  spacer.className = 'mod-spacer';
  frag.appendChild(spacer);

  const themeBtn = buildRailButton({
    id: 'nav-theme-toggle', iconSymbol: 'i-moon',
  });
  themeBtn.style.setProperty('--nav-d', `${40 + MODULES.length * 40}ms`);
  themeBtn.addEventListener('click', toggleTheme);

  const localeBtn = buildRailButton({
    id: 'nav-locale-toggle', text: 'EN',
  });
  localeBtn.style.setProperty('--nav-d', `${80 + MODULES.length * 40}ms`);
  localeBtn.addEventListener('click', toggleLocale);

  // ▶ demo button — T30: manual replay trigger for the tick-driven hero story.
  // Enabled (no disabled state); clicking calls window.__SIM.playHeroStory(),
  // which the hero story registers during boot. Defensive: no-op if not yet wired.
  const demoBtn = buildRailButton({
    id: 'nav-demo', klass: 'rail-btn-demo', iconSymbol: 'i-play',
  });
  demoBtn.style.setProperty('--nav-d', `${120 + MODULES.length * 40}ms`);
  demoBtn.addEventListener('click', () => {
    const sim = typeof window !== 'undefined' ? window.__SIM : null;
    if (sim && typeof sim.playHeroStory === 'function') sim.playHeroStory();
  });

  frag.append(themeBtn, localeBtn, demoBtn);
  nav.appendChild(frag);

  // first paint of labels/tooltips (reads t()).
  renderLabels();

  // 7A/6A: repaint labels + tooltips whenever the locale changes.
  onLocaleChange(renderLabels);

  // global keyboard shortcuts 1-9.
  document.addEventListener('keydown', onKeydown);

  // initial active module (router contract: default to first or supplied id).
  const initial = options.initial && buttonsById.has(options.initial)
    ? options.initial : MODULES[0].id;
  setActive(initial);

  return { setActive, setActiveSilent, getActive: () => activeId, modules: MODULES.map((m) => m.id) };
}

export default { initNav };
