// i18n loader — minimal hand-rolled bilingual loader (zh-TW default / en-US).
// No third-party libs. Native ES module. Works in node (document access guarded).
import zhTW from './zh-TW.json' with { type: 'json' };
import enUS from './en-US.json' with { type: 'json' };

const DICTS = { 'zh-TW': zhTW, 'en-US': enUS };
const DEFAULT_LOCALE = 'zh-TW';

let currentLocale = DEFAULT_LOCALE;
const warnedKeys = new Set();
const localeChangeCallbacks = new Set();

export function getLocale() {
  return currentLocale;
}

export function t(key) {
  const dict = DICTS[currentLocale] || DICTS[DEFAULT_LOCALE];
  const value = dict[key];
  if (value === undefined) {
    // 7A: missing key → return the key itself + console.warn deduplicated per key.
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
  }
  return value;
}

// Register a callback invoked after every locale change (the router registers
// refreshActive here later, per 6A — re-running module update so D3 chart text
// re-pulls t(key), which [data-i18n] scanning alone cannot reach inside SVG).
export function onLocaleChange(cb) {
  localeChangeCallbacks.add(cb);
  return () => localeChangeCallbacks.delete(cb);
}

// Scan [data-i18n] elements and set textContent. Guarded for node.
export function applyDom(root) {
  if (typeof document === 'undefined') return;
  const scope = root || document;
  const nodes = scope.querySelectorAll('[data-i18n]');
  nodes.forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
}

export function setLocale(loc) {
  if (!DICTS[loc]) {
    if (!warnedKeys.has(`__locale__:${loc}`)) {
      warnedKeys.add(`__locale__:${loc}`);
      console.warn(`[i18n] unknown locale: ${loc}`);
    }
    return;
  }
  currentLocale = loc;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', loc);
  }
  // Re-scan all [data-i18n] elements.
  applyDom();
  // 6A: force the active module to re-run its full reconcile so SVG text updates.
  localeChangeCallbacks.forEach((cb) => {
    try {
      cb(currentLocale);
    } catch (err) {
      console.warn('[i18n] onLocaleChange callback threw:', err);
    }
  });
}

export default { getLocale, t, setLocale, onLocaleChange, applyDom };
