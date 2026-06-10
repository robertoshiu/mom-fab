// components/button.js — pure factory: Button(props) -> HTMLButtonElement
// Reuses .btn / .btn-primary / .btn-ghost from theme.css. No classes (F4).
import { t } from '../i18n/index.js';

const VARIANT_CLASS = {
  default: 'btn',
  primary: 'btn btn-primary',
  ghost: 'btn btn-ghost',
};

// Button({ label, onClick, variant, disabled, i18nKey, type })
// - i18nKey: when given, label text is resolved via t() at render and the
//   element carries data-i18n so the global locale scan keeps it current (7A).
// - label: literal fallback when no i18nKey (callers should prefer i18nKey).
export function Button({
  label = '',
  onClick,
  variant = 'default',
  disabled = false,
  i18nKey,
  type = 'button',
} = {}) {
  const el = document.createElement('button');
  el.type = type;
  el.className = VARIANT_CLASS[variant] || VARIANT_CLASS.default;
  if (i18nKey) {
    el.setAttribute('data-i18n', i18nKey);
    el.textContent = t(i18nKey);
  } else {
    el.textContent = label;
  }
  el.disabled = !!disabled;
  if (typeof onClick === 'function') {
    el.addEventListener('click', onClick);
  }
  return el;
}

export default Button;
