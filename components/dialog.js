// components/dialog.js — pure factory: Dialog(props) -> { el, close }
// Modal with a HAND-ROLLED focus trap (no <dialog>, no library):
//   - focusin interception: any focus leaving the dialog is pulled back in
//   - Tab / Shift+Tab cycle within the focusable set (tabindex cycling)
//   - on open, focus moves to the dialog title
//   - ESC closes; backdrop click closes
// Reuses .dialog / .dialog-backdrop theme classes. No classes (F4).
import { t } from '../i18n/index.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Dialog({ title, body, onClose, titleI18nKey, showClose })
// Mounts itself to document.body on creation and returns { el, close }.
export function Dialog({
  title = '',
  body = null,
  onClose,
  titleI18nKey,
  showClose = true,
} = {}) {
  const previousFocus =
    typeof document !== 'undefined' ? document.activeElement : null;

  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  // --- title (focus target on open) ---
  const titleId = `dlg-title-${nextId()}`;
  const titleEl = document.createElement('h2');
  titleEl.className = 'label';
  titleEl.id = titleId;
  titleEl.tabIndex = -1; // focusable programmatically, not in Tab order
  if (titleI18nKey) {
    titleEl.setAttribute('data-i18n', titleI18nKey);
    titleEl.textContent = t(titleI18nKey);
  } else {
    titleEl.textContent = title;
  }
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.appendChild(titleEl);

  // --- body ---
  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'panel-body';
  if (body instanceof Node) bodyWrap.appendChild(body);
  else if (body != null) bodyWrap.textContent = String(body);
  dialog.appendChild(bodyWrap);

  // --- close button ---
  if (showClose) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-ghost';
    closeBtn.setAttribute('data-i18n', 'common.close');
    closeBtn.textContent = t('common.close');
    closeBtn.addEventListener('click', () => close());
    dialog.appendChild(closeBtn);
  }

  backdrop.appendChild(dialog);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('focusin', onFocusin, true);
    backdrop.remove();
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
    }
    if (typeof onClose === 'function') onClose();
  }

  function focusables() {
    return Array.from(dialog.querySelectorAll(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    // tabindex cycling: wrap at the ends of the focusable set
    const list = focusables();
    if (list.length === 0) {
      e.preventDefault();
      titleEl.focus();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === titleEl)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // focusin interception: if focus escapes the dialog, pull it back.
  function onFocusin(e) {
    if (closed) return;
    if (!dialog.contains(e.target)) {
      e.stopPropagation();
      const list = focusables();
      (list[0] || titleEl).focus();
    }
  }

  backdrop.addEventListener('mousedown', (e) => {
    // only a click on the backdrop itself (not the dialog) closes
    if (e.target === backdrop) close();
  });

  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('focusin', onFocusin, true);

  document.body.appendChild(backdrop);
  // focus moves to the dialog title on open
  titleEl.focus();

  return { el: backdrop, dialog, close };
}

let _id = 0;
function nextId() {
  return ++_id;
}

export default Dialog;
