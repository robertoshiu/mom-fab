// shell/router.js — main-content SPA router (T13).
// Owns the lifecycle of the 9 lazy-loaded modules in #content:
//   register(id, importer) → set(id): 0.2s fade out → currentModule.destroy()
//   → interruptAll on the container → lazy-load → init(container, ctx) → fade in
//   → per-tick update(container, ctx, tick) driven from the controller's onTick.
//
// Contracts honoured here:
//   - Module contract (T13/H4): { id, label, init(container, ctx),
//     update(container, ctx, tick), destroy() }; ctx = { state, dispatcher, t, router }.
//   - 2B rendering ownership: update() does the full reconcile; the router never
//     touches module-owned DOM beyond destroy()'s safety interrupt/remove.
//   - 6A i18n: onLocaleChange → refreshActive() re-runs the active module's
//     update so SVG/canvas text re-pulls t(key) (DOM [data-i18n] scan can't).
//   - Soft-fail: set() on an unbuilt/throwing module renders a warm inline panel
//     (states.error vocabulary + retry) + console.warn — it must NOT trigger the
//     D14 boot banner (which only catches uncaught window errors / rejections).
//
// No hash / History API — there is no deep-linking requirement.
//
// Styling: zero raw literals — the fade + soft-fail panel CSS is injected once as
// token-only rules (theme.css / index.html are not ours to edit). 1px hairlines
// are allowed as literal borders per the iron rules.

import { eventRouting } from '../scenarios/mom-fab.js';

const STYLE_ID = 'router-styles';
const FADE_MS = 200; // 0.2s opacity fade in/out (spec)

// Token-only stylesheet: the fade wrapper + the warm soft-fail panel. All colour,
// spacing and timing come from var(--*) tokens; the only literals are 1px
// hairline borders (allowed) and the FADE_MS-matched 0.2s transition expressed
// via the --transition token's sibling — we use a dedicated 200ms to match JS.
const CSS = `
#content .route-view {
  position: relative;
  height: 100%;
  min-height: 0;
  opacity: 1;
  transition: opacity ${FADE_MS}ms var(--ease-instrument);
}
#content .route-view.is-fading { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  #content .route-view { transition: none; }
}

#content .route-error {
  max-width: 520px;
  margin: var(--sp-7) auto 0;
  padding: var(--sp-5);
  text-align: center;
}
#content .route-error .label {
  display: block;
  color: var(--danger);
  margin-bottom: var(--sp-3);
}
#content .route-error .route-error-msg {
  font-size: var(--fs-body);
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: var(--sp-4);
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

export class Router {
  // container = #content host; ctxBase = { state, dispatcher, t } (router added here).
  constructor({ container, state, dispatcher, t } = {}) {
    this.container = container;
    this.state = state;
    this.dispatcher = dispatcher;
    this.t = t;

    this._importers = new Map();     // id -> () => import(...)
    this._current = null;            // the live module instance
    this._currentId = null;
    this._view = null;               // the .route-view wrapper the module mounts into
    this._switchSeq = 0;             // monotonic token: only the latest set() wins
    this._lastTick = 0;              // remembered so a freshly-init'd module catches up

    // ctx handed to every module. `router` is THIS so modules can navigate.
    // `focus` is a ONE-SHOT cross-cutting payload (T24): when navigation arrives
    // from an event-river chip, the router stamps the chip's {type, payload, seq,
    // lotId, …} here before the target module mounts. Modules read ctx.focus in
    // init/update to highlight the related entity (e.g. MES selects the chip's
    // lot row, SPC scrolls to the violation). The router clears it after the
    // freshly-mounted module's first update so a stale focus never re-applies on
    // a later locale-driven refreshActive() / per-tick update.
    this._ctx = { state, dispatcher, t, router: this, focus: null };

    this._onModuleChange = (e) => {
      const id = e && e.detail && e.detail.id;
      if (id) this.set(id); // nav clicks carry no focus payload
    };
    this._onRiverNavigate = (e) => {
      const d = (e && e.detail) || {};
      const target = d.module || eventRouting[d.type] || null;
      if (target) this.set(target, this._focusFromDetail(d));
    };
  }

  // Register a module's lazy importer. Idempotent per id.
  register(id, importer) {
    if (typeof importer !== 'function') {
      throw new Error('Router.register: importer must be a function');
    }
    this._importers.set(id, importer);
    return this;
  }

  // Wire the nav + river navigation intents. Call once after construction.
  start() {
    const doc = (this.container && this.container.ownerDocument) || document;
    ensureStyles(doc);
    // nav rail dispatches module:change on window (shell/nav.js).
    window.addEventListener('module:change', this._onModuleChange);
    // event-river chips bubble river:navigate up to the container (shell/event-river.js).
    if (this.container) {
      this.container.addEventListener('river:navigate', this._onRiverNavigate);
    }
    return this;
  }

  getActive() {
    return this._currentId;
  }

  // Normalise a river:navigate detail into a one-shot focus payload modules can
  // consume. The payload carries whatever the originating chip surfaced; we also
  // hoist the most common entity ids to the top level so modules don't all have
  // to know every producer's payload shape.
  _focusFromDetail(d) {
    const p = (d && d.payload) || {};
    return {
      type: d && d.type,
      seq: d && d.seq,
      payload: p,
      lotId: p.lotId || p.lot || null,
      equipmentId: p.equipmentId || p.equipment || null,
      recipeId: p.recipeId || null,
      poId: p.poId || p.id || null,
      tick: p.tick != null ? p.tick : null,
    };
  }

  // Expose the live one-shot focus for modules whose init/update read ctx.focus.
  getFocus() {
    return this._focus || null;
  }

  // Public entry for a navigation intent carrying an event detail (the river's
  // onNavigate bridges here because its bubbling CustomEvent does not reach the
  // router's #content container — they are siblings in the shell, not nested).
  navigateFromEvent(detail) {
    const d = detail || {};
    const target = d.module || eventRouting[d.type] || null;
    if (target) this.set(target, this._focusFromDetail(d));
  }

  // Best-effort interrupt of any in-flight d3 transitions on the container so
  // detached-DOM timers don't accumulate across switches. d3 lands in T28 on
  // window.__SIM.d3; until then this is a graceful no-op (the module's own
  // destroy() also interrupts via chart-kit). Never throws.
  _interruptAll() {
    if (!this.container) return;
    const d3 = typeof window !== 'undefined' && window.__SIM ? window.__SIM.d3 : null;
    if (d3 && typeof d3.select === 'function') {
      try {
        d3.select(this.container).selectAll('*').interrupt();
      } catch (_) { /* defensive: never let cleanup throw */ }
    }
  }

  // Tear down the current module safely. State-first: the module owns its DOM,
  // we only guarantee the contract's interrupt+remove afterwards.
  _teardownCurrent() {
    const mod = this._current;
    this._current = null;
    this._currentId = null;
    if (mod && typeof mod.destroy === 'function') {
      try {
        mod.destroy();
      } catch (err) {
        console.warn('[router] module destroy() threw:', err && err.message);
      }
    }
    this._interruptAll();
    // Drop the old view wrapper entirely (removes any DOM the module left behind).
    if (this._view && this._view.parentNode) {
      this._view.parentNode.removeChild(this._view);
    }
    this._view = null;
  }

  // Render the warm soft-fail panel (states.error vocabulary + retry). This is a
  // module-level inline panel, NOT the D14 boot banner. Retry re-runs set(id).
  _renderSoftFail(id) {
    const doc = (this.container && this.container.ownerDocument) || document;
    this.container.textContent = '';
    const view = doc.createElement('div');
    view.className = 'route-view';
    const panel = doc.createElement('div');
    panel.className = 'route-error panel';
    panel.setAttribute('role', 'alert');

    const label = doc.createElement('span');
    label.className = 'label';
    label.textContent = this.t('states.error');
    panel.appendChild(label);

    const msg = doc.createElement('div');
    msg.className = 'route-error-msg';
    msg.textContent = this.t('states.empty'); // generic "no data" while the module is unbuilt
    panel.appendChild(msg);

    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = this.t('states.action.retry');
    retry.addEventListener('click', () => this.set(id));
    panel.appendChild(retry);

    view.appendChild(panel);
    this.container.appendChild(view);
    this._view = view;
  }

  // Switch to a module. Final-wins under rapid switching: each call bumps the
  // switch token; any async continuation that finds itself stale aborts before
  // mutating the DOM, so the last set() within a burst is the only one that mounts.
  async set(id, focus) {
    if (!this._importers.has(id)) {
      console.warn('[router] set() for unregistered module:', id);
      return;
    }
    const seq = ++this._switchSeq;
    // Stamp the one-shot focus payload for this switch. If the same module is
    // re-targeted (e.g. an spc.violation chip while SPC is already active) we
    // still want it to re-focus, so set() always (re)writes ctx.focus — even to
    // null when navigation carried no payload.
    this._focus = focus || null;
    this._ctx.focus = this._focus;

    // (1) fade the current view out (0.2s) — but only if there is one to fade.
    if (this._view) {
      this._view.classList.add('is-fading');
      await this._delay(FADE_MS);
      if (seq !== this._switchSeq) return; // superseded mid-fade → abandon
    }

    // (2) destroy + interrupt + remove the current module's DOM.
    this._teardownCurrent();
    if (seq !== this._switchSeq) return;

    // (3) lazy-load + init the new module. Soft-fail (warm panel) on any throw.
    let mod;
    try {
      const m = await this._importers.get(id)();
      if (seq !== this._switchSeq) return; // a newer switch already took over
      mod = (m && m.default) || m;
      if (!mod || typeof mod.init !== 'function') {
        throw new Error('module "' + id + '" has no default export with init()');
      }
    } catch (err) {
      if (seq !== this._switchSeq) return;
      console.warn('[router] module "' + id + '" failed to load:', err && err.message);
      this._renderSoftFail(id);
      this._currentId = id; // remember intent so nav highlight + retry stay coherent
      return;
    }

    // (4) mount: fresh view wrapper (starts faded), init, then fade in.
    const doc = (this.container && this.container.ownerDocument) || document;
    this.container.textContent = '';
    const view = doc.createElement('div');
    view.className = 'route-view is-fading';
    this.container.appendChild(view);
    this._view = view;

    try {
      mod.init(view, this._ctx);
    } catch (err) {
      if (seq !== this._switchSeq) return;
      console.warn('[router] module "' + id + '" init() threw:', err && err.message);
      this._teardownCurrent();
      this._renderSoftFail(id);
      this._currentId = id;
      return;
    }
    if (seq !== this._switchSeq) {
      // superseded during init — destroy what we just built and bail.
      this._current = mod;
      this._currentId = id;
      this._teardownCurrent();
      return;
    }

    this._current = mod;
    this._currentId = id;

    // catch the freshly-mounted module up to the current tick before fading in.
    // ctx.focus is still set here so this first update can honour it; we clear
    // it immediately afterwards so subsequent per-tick updates / refreshActive()
    // never re-apply a stale focus.
    this._safeUpdate(this._lastTick);
    this._focus = null;
    this._ctx.focus = null;

    // fade in on the next frame so the browser registers the faded start state.
    this._raf(() => {
      if (seq === this._switchSeq && this._view === view) {
        view.classList.remove('is-fading');
      }
    });
  }

  // Per-tick drive — wired from the controller's onTick. Full reconcile (2B).
  tick(t) {
    this._lastTick = t;
    this._safeUpdate(t);
  }

  // 6A: re-run the active module's full reconcile (locale change). Re-reads t().
  refreshActive() {
    this._safeUpdate(this._lastTick);
  }

  // Error isolation (T24 #4): a throwing module update() must never break the
  // tick loop — mirror of the dispatcher's per-subscriber try/catch in emit().
  // The controller's onTick calls router.tick() last; if this threw, the tick
  // would still complete (state/KPI already mutated), but the next tick's
  // scheduler callback would surface an uncaught error. We swallow + warn so the
  // heartbeat (and every other module's future update) survives a bad module.
  _safeUpdate(t) {
    const mod = this._current;
    if (!mod || typeof mod.update !== 'function' || !this._view) return;
    try {
      mod.update(this._view, this._ctx, t);
    } catch (err) {
      console.warn('[router] module "' + this._currentId + '" update() threw:', err && err.message);
    }
  }

  destroy() {
    window.removeEventListener('module:change', this._onModuleChange);
    if (this.container) {
      this.container.removeEventListener('river:navigate', this._onRiverNavigate);
    }
    this._teardownCurrent();
  }

  // --- timing helpers (no Date.now / setInterval state) ----------------------
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _raf(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }
}

// Build + wire a router, pre-registering all nine modules. ctxBase carries the
// engine handles; the controller calls router.tick(tick) each tick and hands
// onLocaleChange → router.refreshActive().
export function createRouter({ container, state, dispatcher, t }) {
  const router = new Router({ container, state, dispatcher, t });

  // PRE-REGISTER ALL NINE modules now (files arrive in Wave 3; set() on an
  // unbuilt one fails soft into the warm panel, never the boot banner).
  router.register('mes', () => import('../modules/mes.js'));
  router.register('aps', () => import('../modules/aps.js'));
  router.register('erp', () => import('../modules/erp.js'));
  router.register('spc', () => import('../modules/spc.js'));
  router.register('apc', () => import('../modules/apc.js'));
  router.register('wip', () => import('../modules/wip.js'));
  router.register('scm', () => import('../modules/scm.js'));
  router.register('recipe', () => import('../modules/recipe.js'));
  router.register('yield', () => import('../modules/yield.js'));

  router.start();
  return router;
}

export default { Router, createRouter };
