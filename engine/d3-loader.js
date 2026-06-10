// engine/d3-loader.js — D3 v7.8.5 resilient loader (T28, eng-review 1A shape).
//
// WHY: a single esm.sh CDN failure must not take the whole demo down (C3). This
// module is the ONLY thing the "d3" import-map barrel resolves to (C1). It loads
// D3 once at module-graph evaluation via TOP-LEVEL AWAIT — which blocks every
// consumer's import (and therefore the boot spinner, which waits on the module
// graph) until D3 is ready — then re-exports the full API.
//
// TWO PATHS, ONE SHAPE:
//   1. esm.sh ESM (preferred): `export *`, named exports only, NO default. The
//      namespace object's OWN enumerable keys ARE the API (scaleLinear, select…).
//   2. vendor UMD fallback: injects ./vendor/d3.v7.min.js as a <script>, which
//      attaches the full API to globalThis.d3 (a plain object).
//   normalizeD3() folds both into one plain object `D3` carrying the full API,
//   so consumers get an identical surface on either path.
//
// CONSUMER COMPAT: consumers may write EITHER `import d3 from 'd3'` (default) OR
// `import * as d3 from 'd3'` (namespace). To satisfy both against ONE loader we
// provide the default export AND mirror the API as explicit named exports below.
// A namespace import reads those named bindings; a default import reads `default`.
//
// TESTABILITY SEAM (documented): the esm.sh attempt is skipped and the vendor
// path taken directly when EITHER is true at module-evaluation time:
//   (1) globalThis.__D3_FORCE_FALLBACK === true, or
//   (2) localStorage 'D3_FORCE_FALLBACK' === '1'.
// This is the offline-test hook for environments without network emulation (see
// QA scenario task-28-offline-load). The localStorage form is what QA uses: set
// it BEFORE the loader evaluates, e.g. via the browser before navigation:
//     localStorage.setItem('D3_FORCE_FALLBACK', '1'); // then reload
// or an inline <script> in a test page:
//     <script>globalThis.__D3_FORCE_FALLBACK = true;</script>
// The loader evaluates lazily (first module import pulls in chart-kit → d3), so
// the flag just needs to be present before the first module loads.
function forceFallback() {
  if (globalThis.__D3_FORCE_FALLBACK === true) return true;
  try {
    return globalThis.localStorage &&
      globalThis.localStorage.getItem('D3_FORCE_FALLBACK') === '1';
  } catch (e) {
    return false; // localStorage may throw in sandboxed contexts — ignore
  }
}

const ESM_URL = 'https://esm.sh/d3@7.8.5';
const VENDOR_URL = './vendor/d3.v7.min.js';

// Fold a module namespace OR a UMD global into a plain full-API object.
// - esm.sh namespace: enumerable own keys are the API symbols (no `default`).
//   Copying them onto a plain object strips the immutable [Module] wrapper and
//   gives us a uniform, mutable, plain-object surface.
// - UMD global: already a plain object — copy for uniformity.
function normalizeD3(source) {
  const out = {};
  for (const key in source) {
    // Skip the synthetic `default` some bundlers add to namespaces; we rebuild
    // a clean default ourselves so `import d3 from 'd3'` === the API object.
    if (key === 'default') continue;
    out[key] = source[key];
  }
  return out;
}

// Inject the vendor UMD bundle as a classic <script>; resolves once globalThis.d3
// is populated. Rejects on network/parse error so the caller can surface it.
function loadVendorUMD() {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('d3-loader: no document for vendor <script> injection'));
      return;
    }
    const s = document.createElement('script');
    s.src = VENDOR_URL;
    s.async = false;
    s.onload = () => {
      if (globalThis.d3 && typeof globalThis.d3.select === 'function') {
        resolve(globalThis.d3);
      } else {
        reject(new Error('d3-loader: vendor bundle loaded but globalThis.d3 absent'));
      }
    };
    s.onerror = () => reject(new Error('d3-loader: vendor bundle failed to load (' + VENDOR_URL + ')'));
    document.head.appendChild(s);
  });
}

async function loadD3() {
  // Offline-test seam: skip the network attempt entirely.
  if (forceFallback()) {
    console.warn('d3-loader: forced fallback — using vendor bundle (offline-test seam)');
    return normalizeD3(await loadVendorUMD());
  }
  try {
    const m = await import(ESM_URL);
    return normalizeD3(m);
  } catch (e) {
    // CDN unreachable / offline — fall back to the self-hosted UMD bundle.
    console.warn('d3-loader: esm.sh failed, falling back to vendor bundle', e);
    return normalizeD3(await loadVendorUMD());
  }
}

// TOP-LEVEL AWAIT — holds the module graph (and the boot spinner) until D3 is
// ready on whichever path succeeds.
const D3 = await loadD3();

// Register on the QA contract surface if it already exists. app.js seeds
// window.__SIM.d3 = null (its file, not ours); doing it here as a guarded side
// effect lets the QA check (window.__SIM.d3 truthy) pass without editing app.js.
if (typeof globalThis !== 'undefined' && globalThis.__SIM) {
  globalThis.__SIM.d3 = D3;
}

// Default export — `import d3 from 'd3'` gets the full API object.
export default D3;

// Named exports — `import * as d3 from 'd3'` reads these bindings. We expose the
// symbols the consumers use (chart-kit + modules: aps/apc/wip/yield) plus a few
// common neighbours, so either import style yields the same working API.
export const select = D3.select;
export const selectAll = D3.selectAll;
export const scaleLinear = D3.scaleLinear;
export const scaleBand = D3.scaleBand;
export const scaleOrdinal = D3.scaleOrdinal;
export const scaleTime = D3.scaleTime;
export const line = D3.line;
export const area = D3.area;
export const curveLinear = D3.curveLinear;
export const curveMonotoneX = D3.curveMonotoneX;
export const max = D3.max;
export const min = D3.min;
export const extent = D3.extent;
export const mean = D3.mean;
export const sum = D3.sum;
export const range = D3.range;
export const axisBottom = D3.axisBottom;
export const axisLeft = D3.axisLeft;
export const easeCubicInOut = D3.easeCubicInOut;
export const easeCubic = D3.easeCubic;
export const interpolate = D3.interpolate;
export const format = D3.format;
export const pointer = D3.pointer;
export const version = D3.version;
