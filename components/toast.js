// components/toast.js — pure factory: Toast(props) -> { el, dismiss }
// Top-right transient notice, 3s auto-dismiss.
// (6A) Normal toasts live in an aria-live="polite" region; alarm-level toasts
// (type 'alarm', or the spc.violation trigger) escalate to aria-live="assertive"
// in a separate region so screen readers interrupt. No classes (F4).
import { t } from '../i18n/index.js';

const TYPE_BADGE = {
  info: 'badge-info',
  success: 'badge-success',
  warn: 'badge-warn',
  danger: 'badge-danger',
  alarm: 'badge-danger',
};

// type 'alarm' (or 'danger' raised by an spc.violation) routes to the assertive
// region. Everything else is announced politely.
const ASSERTIVE_TYPES = new Set(['alarm']);

let politeRegion = null;
let assertiveRegion = null;

function ensureRegions() {
  if (typeof document === 'undefined') return;
  if (!politeRegion) {
    politeRegion = document.createElement('div');
    politeRegion.id = 'toast-region-polite';
    politeRegion.className = 'toast-region';
    politeRegion.setAttribute('aria-live', 'polite');
    politeRegion.setAttribute('aria-atomic', 'false');
    document.body.appendChild(politeRegion);
  }
  if (!assertiveRegion) {
    assertiveRegion = document.createElement('div');
    assertiveRegion.id = 'toast-region-assertive';
    assertiveRegion.className = 'toast-region toast-region-assertive';
    assertiveRegion.setAttribute('aria-live', 'assertive');
    assertiveRegion.setAttribute('aria-atomic', 'false');
    document.body.appendChild(assertiveRegion);
  }
}

// Toast({ message, type, duration, i18nKey, assertive })
// - message: literal text (already-localized) OR pass i18nKey to resolve via t().
// - assertive: force the assertive region regardless of type.
// duration default 3000ms; duration<=0 keeps it until manual dismiss.
export function Toast({
  message = '',
  type = 'info',
  duration = 3000,
  i18nKey,
  assertive = false,
} = {}) {
  ensureRegions();
  const isAssertive = assertive || ASSERTIVE_TYPES.has(type);
  const region = isAssertive ? assertiveRegion : politeRegion;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', isAssertive ? 'alert' : 'status');

  const dot = document.createElement('i');
  dot.className = `led ${ledClassFor(type)}`;
  el.appendChild(dot);

  const text = document.createElement('span');
  text.className = `toast-msg ${TYPE_BADGE[type] || ''}`.trim();
  if (i18nKey) {
    text.setAttribute('data-i18n', i18nKey);
    text.textContent = t(i18nKey);
  } else {
    text.textContent = message;
  }
  el.appendChild(text);

  region.appendChild(el);

  let timer = null;
  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (timer) clearTimeout(timer);
    el.classList.add('toast-leaving');
    // remove after the leave transition; guard if reduced-motion zeros it
    const done = () => el.remove();
    el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 260);
  }

  if (duration > 0) {
    timer = setTimeout(dismiss, duration);
  }

  return { el, dismiss };
}

function ledClassFor(type) {
  if (type === 'success' || type === 'info') return 'led-ok';
  if (type === 'warn') return 'led-warn';
  if (type === 'danger' || type === 'alarm') return 'led-danger';
  return '';
}

export default Toast;
