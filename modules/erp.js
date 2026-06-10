// modules/erp.js — ERP module (T17): BOM expand tree (left) + PO Kanban (right).
//
// MODULE CONTRACT (T13): default export { id, label, init, update, destroy }.
// ctx = { state, dispatcher, t, router }.
//
// Left:  BOM 展開樹 — 5 products × deterministically-derived components.
//        Single-level drill-down only (M-rule: no multi-level). Click a product
//        row to expand ONE level of components, click again to collapse.
// Right: PO Kanban — 5 columns Draft → Submitted → Approved → In Transit →
//        Received. Cards advance left→right on `po.received` /
//        `material.in_transit` events, with a token-timed slide animation.
//        Actions: Create PO (Dialog form → new Draft card), Approve, Cancel.
//
// Rules honoured:
//   - NO Math.random/Date.now: all derivation via engine/prng.js domain streams.
//   - Domain constants only from scenarios/mom-fab.js (products, toolGroups).
//   - User-facing strings via i18n t() re-read at every render (6A).
//   - Token-only injected CSS (data-module="erp"); no raw px/colour literals
//     beyond 1px hairline borders.
//   - chart-kit not needed here (no axes/charts); only DOM + token-timed slide.
//   - Interaction State Matrix 'erp' row: loading / empty / error / success /
//     partial, copy via states.* i18n keys + deterministic tick forecast.

import { products, toolGroups } from '../scenarios/mom-fab.js';
import { deriveSeed, mulberry32 } from '../engine/prng.js';
import { Button } from '../components/button.js';
import { Dialog } from '../components/dialog.js';

// --- Kanban column model (LEFT→RIGHT advancement order) ---------------------
const COLUMNS = [
  { id: 'draft', i18nKey: 'erp.po_draft' },
  { id: 'submitted', i18nKey: 'erp.po_submitted' },
  { id: 'approved', i18nKey: 'erp.po_approved' },
  { id: 'in_transit', i18nKey: 'erp.po_in_transit' },
  { id: 'received', i18nKey: 'erp.po_received' },
];
const COLUMN_INDEX = COLUMNS.reduce((m, c, i) => ((m[c.id] = i), m), {});

// The first inspection / forecast tick used for the EMPTY-state prediction copy.
// Kept deterministic (not wall-clock) per the matrix general rule (b).
const PO_FORECAST_TICK = 4;

// Deterministic material vocabulary for BOM leaves (process-consumable parts).
// These are NOT user-facing brand names; they are generic semiconductor
// consumables, derived/picked deterministically and not hardcoded products.
const MATERIALS = [
  '300mm Si Wafer',
  'Photoresist',
  'CMP Slurry',
  'Sputter Target',
  'Precursor Gas',
  'Quartz Boat',
  'Dopant Source',
  'Cleanroom Solvent',
];

function intIn(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Derive a stable component list for one product (single level).
// Components map to the recipe tool groups the product visits + a consumable.
function bomComponentsFor(product) {
  const rng = mulberry32(deriveSeed('erp-bom', product.id));
  const count = Math.min(toolGroups.length, 4 + (product.recipeCount % 3));
  const picked = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let gi = intIn(rng, 0, toolGroups.length - 1);
    let guard = 0;
    while (used.has(gi) && guard < toolGroups.length) {
      gi = (gi + 1) % toolGroups.length;
      guard++;
    }
    used.add(gi);
    const group = toolGroups[gi];
    const material = MATERIALS[intIn(rng, 0, MATERIALS.length - 1)];
    picked.push({
      id: product.id + '-' + group.id,
      group: group.id,
      groupName: group.name,
      material,
      qty: intIn(rng, 1, 6),
      leadDays: intIn(rng, 3, 21),
    });
  }
  return picked;
}

// Seed an initial deterministic PO set so SUCCESS/PARTIAL states are reachable
// without user action. PO numbers derive from a stream; columns spread so the
// kanban demonstrates multiple populated columns.
function seedInitialPOs() {
  const rng = mulberry32(deriveSeed('erp-po', 'seed'));
  const pos = [];
  const seedCols = ['submitted', 'approved', 'in_transit', 'received', 'approved'];
  for (let i = 0; i < seedCols.length; i++) {
    const product = products[intIn(rng, 0, products.length - 1)];
    const num = 2200 + intIn(rng, 1, 80);
    pos.push({
      id: 'PO-' + num,
      product: product.id,
      productName: product.name,
      qty: intIn(rng, 1, 12),
      column: seedCols[i],
      seq: i,
    });
  }
  return pos;
}

const erp = {
  id: 'erp',
  label: 'ERP',

  init(container, ctx) {
    this._injectStyles(container);
    this._dispatcher = ctx.dispatcher;

    // --- module-local state (PRNG-seeded, deterministic) ---
    this._pos = seedInitialPOs();
    this._poCounter = 2280; // next PO number base; advanced deterministically
    this._expanded = new Set(); // expanded product ids (single-level)
    this._errored = false; // ERROR-state latch (reset via retry)
    this._cards = new Map(); // poId -> card element (for incremental moves)
    this._slideTimers = new Set();

    // root scaffold
    const root = document.createElement('div');
    root.className = 'erp-root';
    container.appendChild(root);
    this._root = root;

    // --- module head: title + actions ---
    const head = document.createElement('div');
    head.className = 'erp-head';
    const h1 = document.createElement('h1');
    h1.setAttribute('data-i18n', 'erp.title');
    h1.textContent = ctx.t('erp.title');
    head.appendChild(h1);

    const actions = document.createElement('div');
    actions.className = 'erp-actions mobile-actions'; // T33: collapse to notice <768
    const createBtn = Button({
      i18nKey: 'erp.action.create',
      variant: 'primary',
      onClick: () => this._openCreateDialog(ctx),
    });
    createBtn.setAttribute('data-role', 'create-po');
    actions.appendChild(createBtn);
    // T33 <768 desktop-only notice (shown by responsive.css when buttons hide).
    const erpDtOnly = document.createElement('span');
    erpDtOnly.className = 'mobile-desktop-only';
    erpDtOnly.setAttribute('data-i18n', 'common.desktop_only');
    erpDtOnly.textContent = ctx.t('common.desktop_only');
    actions.appendChild(erpDtOnly);
    head.appendChild(actions);
    root.appendChild(head);

    // --- grid: BOM (left) + Kanban (right) ---
    const grid = document.createElement('div');
    grid.className = 'erp-grid';
    root.appendChild(grid);

    // BOM panel
    const bomPanel = document.createElement('div');
    bomPanel.className = 'panel erp-bom';
    bomPanel.dataset.mobile = 'hide'; // T33 <768: BOM tree hidden (rep = kanban)
    const bomHead = document.createElement('div');
    bomHead.className = 'panel-head';
    const bomLabel = document.createElement('span');
    bomLabel.className = 'label';
    bomLabel.setAttribute('data-i18n', 'erp.bom');
    bomLabel.textContent = ctx.t('erp.bom');
    bomHead.appendChild(bomLabel);
    const bomMeta = document.createElement('span');
    bomMeta.className = 'erp-meta num';
    bomMeta.textContent = String(products.length);
    bomHead.appendChild(bomMeta);
    bomPanel.appendChild(bomHead);
    const bomBody = document.createElement('div');
    bomBody.className = 'panel-body scroll-y erp-tree';
    bomBody.setAttribute('role', 'tree');
    bomPanel.appendChild(bomBody);
    grid.appendChild(bomPanel);
    this._bomBody = bomBody;

    // Kanban panel
    const kbPanel = document.createElement('div');
    kbPanel.className = 'panel erp-kanban';
    kbPanel.dataset.mobile = 'rep'; // T33 <768 representative panel: ERP kanban
    const kbHead = document.createElement('div');
    kbHead.className = 'panel-head';
    const kbLabel = document.createElement('span');
    kbLabel.className = 'label';
    kbLabel.textContent = 'PO Workflow';
    kbLabel.setAttribute('data-role', 'kb-title');
    kbHead.appendChild(kbLabel);
    const kbMeta = document.createElement('span');
    kbMeta.className = 'erp-meta num';
    kbMeta.setAttribute('data-role', 'po-count');
    kbHead.appendChild(kbMeta);
    kbPanel.appendChild(kbHead);
    const kbBody = document.createElement('div');
    kbBody.className = 'panel-body erp-board';
    kbBody.setAttribute('data-role', 'board');
    kbPanel.appendChild(kbBody);
    grid.appendChild(kbPanel);
    this._kbBody = kbBody;
    this._kbMeta = kbMeta;

    // build static column shells once; cards patched in update()
    this._columnBodies = {};
    for (const col of COLUMNS) {
      const colEl = document.createElement('div');
      colEl.className = 'erp-col';
      colEl.dataset.col = col.id;
      const ch = document.createElement('div');
      ch.className = 'erp-col-head label';
      ch.setAttribute('data-i18n', col.i18nKey);
      ch.textContent = ctx.t(col.i18nKey);
      colEl.appendChild(ch);
      const cb = document.createElement('div');
      cb.className = 'erp-col-body';
      cb.dataset.colBody = col.id;
      colEl.appendChild(cb);
      kbBody.appendChild(colEl);
      this._columnBodies[col.id] = cb;
    }

    // subscribe: PO received + material in transit advance cards
    ctx.dispatcher.subscribeAll(this.id, {
      'po.received': (payload) => this._onPoReceived(payload, ctx),
      'material.in_transit': (payload) => this._onMaterialInTransit(payload, ctx),
    });
  },

  // ---- event handlers: mutate state first, then idempotent patch (2B) ----
  _onPoReceived(payload, ctx) {
    // Advance the most-progressed non-received PO one column toward Received,
    // or mark a specific PO if the payload names one.
    const id = payload && payload.id;
    let target = id ? this._pos.find((p) => p.id === id) : null;
    if (!target) {
      target = this._frontmost(['in_transit', 'approved', 'submitted', 'draft']);
    }
    if (target) this._advance(target, 'received', ctx);
  },

  _onMaterialInTransit(payload, ctx) {
    // A material move nudges an approved PO into In Transit.
    const target = this._frontmost(['approved', 'submitted', 'draft']);
    if (target) this._advance(target, 'in_transit', ctx);
  },

  _frontmost(order) {
    for (const colId of order) {
      const hit = this._pos.find((p) => p.column === colId);
      if (hit) return hit;
    }
    return null;
  },

  _advance(po, toColumn, ctx) {
    const from = COLUMN_INDEX[po.column];
    const to = COLUMN_INDEX[toColumn];
    if (to <= from) return; // never move backward
    po.column = toColumn;
    this._renderCards(ctx, po.id);
  },

  // ---- Create PO dialog -------------------------------------------------
  _openCreateDialog(ctx) {
    const form = document.createElement('form');
    form.className = 'erp-form';
    form.setAttribute('data-role', 'create-form');

    // product select
    const pLabel = document.createElement('label');
    pLabel.className = 'erp-field';
    const pSpan = document.createElement('span');
    pSpan.className = 'label';
    pSpan.setAttribute('data-i18n', 'erp.bom');
    pSpan.textContent = ctx.t('erp.bom');
    const select = document.createElement('select');
    select.className = 'erp-select';
    select.setAttribute('data-role', 'po-product');
    for (const p of products) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    }
    pLabel.appendChild(pSpan);
    pLabel.appendChild(select);
    form.appendChild(pLabel);

    // qty input
    const qLabel = document.createElement('label');
    qLabel.className = 'erp-field';
    const qSpan = document.createElement('span');
    qSpan.className = 'label';
    qSpan.textContent = 'Qty (lots)';
    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.max = '99';
    qty.value = '1';
    qty.className = 'erp-input num';
    qty.setAttribute('data-role', 'po-qty');
    qLabel.appendChild(qSpan);
    qLabel.appendChild(qty);
    form.appendChild(qLabel);

    // submit row
    const row = document.createElement('div');
    row.className = 'erp-form-actions';
    const submit = Button({
      i18nKey: 'erp.action.create',
      variant: 'primary',
      type: 'submit',
    });
    submit.setAttribute('data-role', 'po-submit');
    row.appendChild(submit);
    form.appendChild(row);

    const dlg = Dialog({ titleI18nKey: 'erp.action.create', body: form });

    const onSubmit = (e) => {
      e.preventDefault();
      const productId = select.value;
      const product = products.find((p) => p.id === productId) || products[0];
      const q = Math.max(1, Math.min(99, parseInt(qty.value, 10) || 1));
      this._createPo(product, q, ctx);
      dlg.close();
    };
    form.addEventListener('submit', onSubmit);
  },

  _createPo(product, qty, ctx) {
    // Deterministic PO number: monotonic counter, no randomness.
    this._poCounter += 1;
    const po = {
      id: 'PO-' + this._poCounter,
      product: product.id,
      productName: product.name,
      qty,
      column: 'draft',
      seq: this._pos.length,
    };
    this._pos.push(po);
    this._renderCards(ctx, po.id);
  },

  _approve(po, ctx) {
    // Draft → Submitted, or Submitted → Approved (one decisive step forward).
    const next = po.column === 'draft' ? 'submitted' : po.column === 'submitted' ? 'approved' : null;
    if (next) this._advance(po, next, ctx);
  },

  _cancel(po, ctx) {
    const i = this._pos.indexOf(po);
    if (i >= 0) {
      this._pos.splice(i, 1);
      this._renderCards(ctx);
    }
  },

  // ---- full reconcile (2B; re-reads t()) --------------------------------
  update(container, ctx, tick) {
    this._tick = tick;
    const t = ctx.t;

    // re-pull i18n for head + column headers + create button (6A)
    const h1 = this._root.querySelector('h1[data-i18n="erp.title"]');
    if (h1) h1.textContent = t('erp.title');
    const bomLabel = this._root.querySelector('.erp-bom .label[data-i18n="erp.bom"]');
    if (bomLabel) bomLabel.textContent = t('erp.bom');
    const createBtn = this._root.querySelector('[data-role="create-po"]');
    if (createBtn) createBtn.textContent = t('erp.action.create');
    for (const col of COLUMNS) {
      const ch = this._kbBody.querySelector('[data-col="' + col.id + '"] .erp-col-head');
      if (ch) ch.textContent = t(col.i18nKey);
    }

    // Determine interaction state for the kanban region.
    const state = this._resolveState(tick);
    this._kbBody.dataset.state = state;

    this._renderTree(ctx);
    this._renderBoard(ctx, state, tick);

    // meta count
    this._kbMeta.textContent = String(this._pos.length);

    // T24 cross-cutting focus: a po.received chip (or any nav carrying a poId)
    // highlights that PO card. One-shot (router clears ctx.focus after this
    // first update) so it never re-applies on a later per-tick reconcile.
    const focus = ctx.focus;
    if (focus && focus.poId) this._focusCard(focus.poId);
  },

  // ERROR is latched only by an explicit (simulated) failure; we never inject
  // one here, so the realised states are loading → empty → partial → success.
  _resolveState(tick) {
    if (this._errored) return 'error';
    if (this._pos.length === 0) {
      // loading on tick 0 (data settling) else empty with forecast copy
      return tick <= 0 ? 'loading' : 'empty';
    }
    // partial while some columns still empty AND window not yet "full"
    const filledCols = new Set(this._pos.map((p) => p.column));
    if (filledCols.size < COLUMNS.length) return 'partial';
    return 'success';
  },

  _renderTree(ctx) {
    const t = ctx.t;
    const body = this._bomBody;
    body.replaceChildren();
    for (const product of products) {
      const isOpen = this._expanded.has(product.id);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'erp-tnode' + (isOpen ? ' is-open' : '');
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-expanded', String(isOpen));
      row.dataset.product = product.id;

      const caret = document.createElement('span');
      caret.className = 'erp-caret';
      caret.textContent = isOpen ? '▾' : '▸';
      row.appendChild(caret);

      const name = document.createElement('span');
      name.className = 'erp-tname';
      name.textContent = product.name;
      row.appendChild(name);

      const led = document.createElement('i');
      led.className = 'led ' + (product.priority === 'high' ? 'led-warn' : 'led-run');
      row.appendChild(led);

      row.addEventListener('click', () => {
        // mutate state first, then re-render (single-level toggle)
        if (this._expanded.has(product.id)) this._expanded.delete(product.id);
        else this._expanded.add(product.id);
        this._renderTree(ctx);
      });
      body.appendChild(row);

      if (isOpen) {
        const children = bomComponentsFor(product);
        const group = document.createElement('div');
        group.className = 'erp-tchildren';
        group.setAttribute('role', 'group');
        for (const c of children) {
          const leaf = document.createElement('div');
          leaf.className = 'erp-tleaf';
          leaf.setAttribute('role', 'treeitem');
          const lname = document.createElement('span');
          lname.className = 'erp-leaf-name';
          lname.textContent = c.groupName + ' · ' + c.material;
          leaf.appendChild(lname);
          const lqty = document.createElement('span');
          lqty.className = 'erp-leaf-qty num';
          lqty.textContent = '×' + c.qty + '  ' + c.leadDays + 'd';
          leaf.appendChild(lqty);
          group.appendChild(leaf);
        }
        body.appendChild(group);
      }
    }
    void t; // tree content is product names (domain) + numbers; no i18n strings
  },

  _renderBoard(ctx, state, tick) {
    // empty / loading / error overlays sit above the column shells
    let overlay = this._kbBody.querySelector('.erp-state');
    const needOverlay = state === 'empty' || state === 'loading' || state === 'error';

    if (needOverlay) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'erp-state';
        this._kbBody.appendChild(overlay);
      }
      overlay.replaceChildren();
      overlay.dataset.kind = state;
      if (state === 'loading') {
        overlay.appendChild(this._skeletonColumns());
      } else if (state === 'empty') {
        overlay.appendChild(this._emptyBlock(ctx, tick));
      } else if (state === 'error') {
        overlay.appendChild(this._errorBlock(ctx));
      }
    } else if (overlay) {
      overlay.remove();
    }

    // cards always rendered (under overlay when present); for partial state the
    // empty columns simply show faded gridlines via [data-state=partial] CSS.
    this._renderCards(ctx);
  },

  _renderCards(ctx, slideId) {
    const t = ctx.t;
    // group POs by column preserving insertion order
    for (const col of COLUMNS) {
      const cb = this._columnBodies[col.id];
      if (!cb) continue;
      cb.replaceChildren();
    }
    for (const po of this._pos) {
      const cb = this._columnBodies[po.column];
      if (!cb) continue;
      const card = document.createElement('div');
      card.className = 'card erp-card';
      card.dataset.po = po.id;
      if (slideId && po.id === slideId) card.classList.add('erp-slide');

      const top = document.createElement('div');
      top.className = 'erp-card-top';
      const idEl = document.createElement('span');
      idEl.className = 'erp-card-id num';
      idEl.textContent = po.id;
      top.appendChild(idEl);
      const qEl = document.createElement('span');
      qEl.className = 'erp-card-qty num';
      qEl.textContent = '×' + po.qty;
      top.appendChild(qEl);
      card.appendChild(top);

      const prod = document.createElement('div');
      prod.className = 'erp-card-prod';
      prod.textContent = po.productName;
      card.appendChild(prod);

      // actions for actionable columns (draft/submitted)
      if (po.column === 'draft' || po.column === 'submitted') {
        const acts = document.createElement('div');
        acts.className = 'erp-card-acts';
        const approve = Button({
          i18nKey: 'erp.action.approve',
          variant: 'ghost',
          onClick: () => this._approve(po, ctx),
        });
        approve.setAttribute('data-role', 'approve');
        const cancel = Button({
          i18nKey: 'erp.action.cancel',
          variant: 'ghost',
          onClick: () => this._cancel(po, ctx),
        });
        cancel.setAttribute('data-role', 'cancel');
        acts.appendChild(approve);
        acts.appendChild(cancel);
        card.appendChild(acts);
      }

      cb.appendChild(card);
    }
    void t;
  },

  // T24: highlight + scroll a focused PO card (cross-module navigation target).
  _focusCard(poId) {
    if (!this._kbBody) return;
    const all = this._kbBody.querySelectorAll('.erp-card');
    all.forEach((c) => c.classList.remove('erp-card-focus'));
    const card = this._kbBody.querySelector('.erp-card[data-po="' + (window.CSS && CSS.escape ? CSS.escape(poId) : poId) + '"]');
    if (card) {
      card.classList.add('erp-card-focus');
      if (typeof card.scrollIntoView === 'function') {
        try { card.scrollIntoView({ block: 'nearest' }); } catch (_) { /* defensive */ }
      }
    }
  },

  _skeletonColumns() {
    const wrap = document.createElement('div');
    wrap.className = 'erp-skel';
    for (let i = 0; i < COLUMNS.length; i++) {
      const c = document.createElement('div');
      c.className = 'erp-skel-col';
      for (let j = 0; j < 2; j++) {
        const b = document.createElement('div');
        b.className = 'erp-skel-card chartkit-shimmer';
        c.appendChild(b);
      }
      wrap.appendChild(c);
    }
    return wrap;
  },

  _emptyBlock(ctx, tick) {
    const t = ctx.t;
    const block = document.createElement('div');
    block.className = 'erp-empty';
    const msg = document.createElement('p');
    msg.className = 'erp-empty-msg';
    // states.erp.empty already carries warm copy; append deterministic forecast.
    const remaining = Math.max(0, PO_FORECAST_TICK - (tick || 0));
    const forecast =
      remaining > 0 ? ' · ~tick ' + PO_FORECAST_TICK + ' (' + remaining + ')' : '';
    msg.textContent = t('states.erp.empty') + forecast;
    block.appendChild(msg);
    return block;
  },

  _errorBlock(ctx) {
    const t = ctx.t;
    const block = document.createElement('div');
    block.className = 'erp-error';
    const msg = document.createElement('p');
    msg.className = 'erp-error-msg';
    msg.textContent = t('states.error');
    block.appendChild(msg);
    const retry = Button({
      i18nKey: 'states.action.retry',
      variant: 'ghost',
      onClick: () => {
        this._errored = false;
        this.update(this._root.parentNode, ctx, this._tick || 0);
      },
    });
    block.appendChild(retry);
    return block;
  },

  destroy() {
    for (const id of this._slideTimers) clearTimeout(id);
    if (this._slideTimers) this._slideTimers.clear();
    if (this._dispatcher) this._dispatcher.unsubscribeAll(this.id);
    if (this._root && this._root.parentNode) this._root.remove();
    if (this._cards) this._cards.clear();
  },

  _injectStyles(container) {
    const doc = (container && container.ownerDocument) || document;
    if (doc.querySelector('style[data-module="erp"]')) return;
    const style = doc.createElement('style');
    style.setAttribute('data-module', 'erp');
    style.textContent = ERP_CSS;
    doc.head.appendChild(style);
  },
};

const ERP_CSS = `
.erp-root { display: flex; flex-direction: column; gap: var(--sp-3); height: 100%; min-height: 0; }
.erp-head { display: flex; align-items: baseline; gap: var(--sp-3); }
.erp-head h1 { font-size: var(--fs-title); font-weight: var(--fw-emphasis); margin: 0; letter-spacing: 0.01em; }
.erp-actions { margin-left: auto; display: flex; gap: var(--sp-2); }
.erp-meta { font: var(--fw-body) var(--fs-caption) var(--font-mono); color: var(--text-secondary); margin-left: auto; }

.erp-grid { display: grid; grid-template-columns: 320px 1fr; gap: var(--sp-3); min-height: 0; flex: 1; }
.erp-bom, .erp-kanban { display: flex; flex-direction: column; min-height: 0; }
.erp-bom .panel-body, .erp-kanban .panel-body { min-height: 0; }

.panel-head { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--hairline); }
.panel-body { padding: var(--sp-3); }

/* ---- BOM tree ---- */
.erp-tree { display: flex; flex-direction: column; gap: var(--sp-1); overflow-y: auto; }
.erp-tnode {
  display: flex; align-items: center; gap: var(--sp-2);
  height: var(--table-row-h); padding: 0 var(--sp-2);
  background: none; border: 1px solid transparent; border-radius: var(--r-card);
  color: var(--text-primary); cursor: pointer; text-align: left; width: 100%;
  font: var(--fw-emphasis) var(--fs-body) var(--font-body);
  transition: border-color var(--transition), background-color var(--transition);
}
.erp-tnode:hover { border-color: var(--accent-dim); }
.erp-tnode:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.erp-tnode.is-open { color: var(--accent); }
.erp-caret { width: var(--sp-3); color: var(--text-secondary); font-size: var(--fs-caption); }
.erp-tnode.is-open .erp-caret { color: var(--accent); }
.erp-tname { flex: 1; }
.erp-tnode .led { margin-left: auto; }
.erp-tchildren { display: flex; flex-direction: column; padding-left: var(--sp-5); }
.erp-tleaf {
  display: flex; align-items: center; gap: var(--sp-2);
  height: var(--table-row-h); padding: 0 var(--sp-2);
  border-left: 1px solid var(--hairline);
  font: var(--fw-body) var(--fs-body) var(--font-body); color: var(--text-secondary);
}
.erp-leaf-name { flex: 1; }
.erp-leaf-qty { color: var(--text-secondary); font-size: var(--fs-caption); }

/* ---- Kanban ---- */
.erp-board { position: relative; display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--sp-2); min-height: 0; overflow: hidden; }
.erp-col { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.erp-col-head { padding: var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--hairline); }
.erp-col-body {
  flex: 1; min-height: 0; padding: var(--sp-2) var(--sp-1);
  display: flex; flex-direction: column; gap: var(--sp-2); overflow-y: auto;
}
/* PARTIAL: empty columns show faded gridlines, left-aligned (no stretch). */
.erp-board[data-state="partial"] .erp-col-body:empty {
  background:
    repeating-linear-gradient(var(--grid), var(--grid) 1px, transparent 1px, transparent var(--table-row-h));
  opacity: 0.6;
}

.erp-card {
  padding: var(--sp-2); display: flex; flex-direction: column; gap: var(--sp-1);
  border-color: var(--hairline);
}
.erp-card-top { display: flex; align-items: baseline; justify-content: space-between; }
.erp-card-id { color: var(--accent); font-weight: var(--fw-emphasis); font-size: var(--fs-body); }
.erp-card-qty { color: var(--text-secondary); font-size: var(--fs-caption); }
.erp-card-prod { color: var(--text-primary); font-size: var(--fs-caption); }
.erp-card-acts { display: flex; gap: var(--sp-1); margin-top: var(--sp-1); }
/* T24 cross-module focus highlight: cyan-edged card (live navigation target) */
.erp-card.erp-card-focus { border-color: var(--accent); box-shadow: inset 2px 0 0 var(--accent); }
.erp-card-acts .btn { padding: 1px var(--sp-2); font-size: var(--fs-caption); }

/* token-timed slide-in when a card moves columns */
.erp-slide { animation: erp-slide-in var(--tick) var(--ease-instrument); }
@keyframes erp-slide-in {
  from { transform: translateX(calc(-1 * var(--sp-3))); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .erp-slide { animation: none; }
}

/* ---- state overlays ---- */
.erp-state { position: absolute; inset: 0; display: grid; place-items: center; background: var(--bg-elevated); }
.erp-state[data-kind="loading"] { place-items: stretch; }
.erp-skel { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--sp-2); padding: var(--sp-3); width: 100%; }
.erp-skel-col { display: flex; flex-direction: column; gap: var(--sp-2); }
.erp-skel-card { height: var(--sp-7); border-radius: var(--r-card); background: var(--bg-inset); }
.chartkit-shimmer { animation: erp-shimmer 1.2s ease-in-out infinite; }
@keyframes erp-shimmer { 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) { .chartkit-shimmer { animation: none; } }

.erp-empty, .erp-error { display: flex; flex-direction: column; align-items: center; gap: var(--sp-3); padding: var(--sp-5); text-align: center; }
.erp-empty-msg { color: var(--text-secondary); font-size: var(--fs-body); margin: 0; }
.erp-error-msg { color: var(--danger); font-size: var(--fs-body); margin: 0; }

/* ---- Create PO form ---- */
.erp-form { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 280px; }
.erp-field { display: flex; flex-direction: column; gap: var(--sp-1); }
.erp-select, .erp-input {
  background: var(--bg-inset); color: var(--text-primary);
  border: 1px solid var(--hairline); border-radius: var(--r-card);
  padding: var(--sp-1) var(--sp-2); font: var(--fw-body) var(--fs-body) var(--font-body);
}
.erp-input.num, .erp-select { font-family: var(--font-mono); }
.erp-select:focus-visible, .erp-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.erp-form-actions { display: flex; justify-content: flex-end; gap: var(--sp-2); }
`;

export default erp;
