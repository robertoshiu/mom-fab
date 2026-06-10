// modules/scm.js — SCM (Supply Chain Management) module (T21).
//
// Module contract (T13): default export { id, label, init, update, destroy }.
// ctx = { state, dispatcher, t, router }.
//
// Composition (mirrors design/reference-spc.html grid craft):
//   上 — 供應商計分卡 (10 supplier cards: on-time % / quality / lead time + LED)
//   下 — 在途物料表 (Table: lot id / supplier / material / qty / ETA / status)
//   actions per in-transit row: Receive / Reject / Escalate → Toast
//   Receive slides the row out (token-timed) and moves it to "received".
//
// Determinism: every supplier metric and every in-transit lot field is derived
// from fnv1a()-seeded mulberry32 streams keyed on a stable id, so the same load
// always yields a deep-equal view. NO Math.random / Date.now anywhere.
//
// Interaction State Matrix (2A) row "SCM":
//   LOADING  — supplier card + table skeleton shimmer
//   EMPTY    — 「尚無在途料 — 等待 PO 發出」warm copy + deterministic tick forecast
//   ERROR    — inline banner (boot vocabulary) + retry button
//   SUCCESS  — 10 supplier cards + in-transit table
//   PARTIAL  — some suppliers scored / table partially filled (left-aligned)

import { fnv1a, mulberry32 } from '../engine/prng.js';
import { toolGroups, products } from '../scenarios/mom-fab.js';
import { Table } from '../components/table.js';
import { Button } from '../components/button.js';
import { Toast } from '../components/toast.js';

const STYLE_ID = 'scm-module-styles';
const SUPPLIER_COUNT = 10;
const IN_TRANSIT_COUNT = 14; // > 10 rows once all have arrived (acceptance: >= 10)

// Stagger material arrivals across this many ticks so the module passes through
// EMPTY → PARTIAL → SUCCESS deterministically as the sim advances.
const ARRIVAL_SPAN = 12;
// First in-transit lot lands at this tick (drives the EMPTY-state forecast copy).
const FIRST_ARRIVAL_TICK = 2;

// Material kinds suppliers ship (domain-flavoured, not a hardcoded product name).
const MATERIAL_KINDS = Object.freeze([
  'Photoresist', 'Silicon Wafer', 'CMP Slurry', 'Sputter Target',
  'Process Gas', 'Etchant', 'Dopant Source', 'CVD Precursor',
]);

// ---------------------------------------------------------------------------
// Deterministic derivation helpers
// ---------------------------------------------------------------------------

function stream(key) {
  return mulberry32(fnv1a('scm:' + key) >>> 0);
}

function intIn(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Build the 10 deterministic suppliers. Each tied to a tool group so the
// material domain stays inside scenarios/mom-fab.js (no invented product names).
function buildSuppliers() {
  const list = [];
  for (let i = 0; i < SUPPLIER_COUNT; i++) {
    const id = 'SUP-' + String(i + 1).padStart(2, '0');
    const rng = stream('supplier:' + id);
    const group = toolGroups[i % toolGroups.length];
    const onTime = intIn(rng, 78, 99) + Math.round(rng() * 10) / 10; // %.x
    const quality = intIn(rng, 80, 99) + Math.round(rng() * 10) / 10; // score
    const leadTime = intIn(rng, 4, 28); // days
    list.push({
      id,
      group: group.id,
      groupName: group.name,
      onTime: Math.min(100, Math.round(onTime * 10) / 10),
      quality: Math.min(100, Math.round(quality * 10) / 10),
      leadTime,
    });
  }
  return list;
}

// Build the deterministic in-transit lot table. arriveTick staggers the rows so
// the state machine walks EMPTY → PARTIAL → SUCCESS as ticks advance.
function buildInTransit(suppliers) {
  const rows = [];
  for (let i = 0; i < IN_TRANSIT_COUNT; i++) {
    const id = 'MAT-' + String(i + 1).padStart(4, '0');
    const rng = stream('lot:' + id);
    const supplier = suppliers[i % suppliers.length];
    const product = pick(rng, products);
    const material = pick(rng, MATERIAL_KINDS);
    const qty = intIn(rng, 1, 24) * 25; // wafers / units, clean multiples
    const arriveTick = FIRST_ARRIVAL_TICK + Math.floor((i / IN_TRANSIT_COUNT) * ARRIVAL_SPAN);
    const etaTick = arriveTick + intIn(rng, 2, 9);
    rows.push({
      id,
      supplier: supplier.id,
      product: product.id,
      material,
      qty,
      arriveTick,
      etaTick,
      status: 'in_transit',
    });
  }
  return rows;
}

// LED descriptor (colour + shape, 6A colour-blind-safe) from a 0..100 metric.
function ledFor(value, warnAt, dangerAt) {
  if (value < dangerAt) return { cls: 'led-danger', shape: '■' };
  if (value < warnAt) return { cls: 'led-warn', shape: '▲' };
  return { cls: 'led-ok', shape: '●' };
}

// Resolve the "English-only" half of a bilingual "A / B" i18n value for the EN
// subtitle accent (matches reference #mod-head .en). Falls back to the whole
// string if there is no separator.
function enHalf(value) {
  const parts = String(value).split(' / ');
  return parts.length > 1 ? parts[parts.length - 1] : value;
}
function primaryHalf(value) {
  return String(value).split(' / ')[0];
}

// ---------------------------------------------------------------------------
// Scoped stylesheet — token-only (zero raw px except 1px hairlines / 0).
// ---------------------------------------------------------------------------

function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.setAttribute('data-module', 'scm');
  style.textContent = `
#scm-root {
  display: grid;
  grid-template-rows: auto minmax(0, 1.1fr) minmax(0, 1fr);
  gap: var(--sp-3);
  min-height: 0;
  height: 100%;
}
#scm-head { display: flex; align-items: baseline; gap: var(--sp-3); }
#scm-head h1 {
  font-size: var(--fs-title); font-weight: var(--fw-emphasis);
  margin: 0; letter-spacing: 0.01em; color: var(--text-primary);
}
#scm-head .en { color: var(--text-secondary); font-size: var(--fs-subtitle); font-weight: var(--fw-body); }
#scm-head .actions { margin-left: auto; display: flex; gap: var(--sp-2); align-items: center; }
#scm-head .tickmeter { font: var(--fw-body) var(--fs-caption) var(--font-mono); color: var(--text-secondary); }
#scm-head .tickmeter b { color: var(--accent); font-weight: var(--fw-kpi); }

.scm-panel { display: flex; flex-direction: column; min-height: 0; }
.scm-panel .panel-head {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--hairline);
}
.scm-panel .panel-head .meta {
  margin-left: auto; font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
}
.scm-panel .panel-body { padding: var(--sp-3); min-height: 0; flex: 1; overflow: hidden; }

/* supplier scorecard grid */
#scm-cards {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--sp-2);
  height: 100%;
  align-content: start;
}
.scm-card {
  background: var(--bg-elevated);
  border: 1px solid var(--hairline);
  border-radius: var(--r-card);
  padding: var(--sp-2) var(--sp-3);
  display: flex; flex-direction: column; gap: var(--sp-1);
  transition: border-color var(--transition), box-shadow var(--transition);
}
.scm-card:hover { border-color: var(--accent-dim); box-shadow: var(--sh-sm); }
.scm-card .scm-card-top { display: flex; align-items: center; gap: var(--sp-2); }
.scm-card .scm-sid {
  font: var(--fw-emphasis) var(--fs-body) var(--font-mono);
  color: var(--text-primary); letter-spacing: 0.03em;
}
.scm-card .scm-grade { margin-left: auto; font-size: var(--fs-caption); }
.scm-card .scm-group { font-size: var(--fs-caption); color: var(--text-secondary); }
.scm-card .scm-metrics { display: flex; flex-direction: column; gap: 2px; margin-top: var(--sp-1); }
.scm-card .scm-metric {
  display: flex; align-items: baseline; gap: var(--sp-2);
  font-size: var(--fs-caption); color: var(--text-secondary);
}
.scm-card .scm-metric .num {
  margin-left: auto; font-size: var(--fs-body); color: var(--text-primary);
}

/* in-transit table host */
#scm-table-host { height: 100%; min-height: 0; }
#scm-table-host .vtable, #scm-table-host .vtable-scroll { height: 100%; }
.scm-row-actions { display: inline-flex; gap: var(--sp-1); }
.scm-row-actions .btn { padding: 1px var(--sp-2); font-size: var(--fs-caption); }
/* T24 cross-module focus highlight on an in-transit row (live nav target) */
tr.scm-row-focus td { background: var(--accent-dim, rgba(0,212,255,0.10)); box-shadow: inset 2px 0 0 var(--accent); }

/* receive slide-out — token-timed (~0.5 tick) */
@keyframes scm-slide-out {
  to { transform: translateX(110%); opacity: 0; }
}
tr.scm-receiving {
  animation: scm-slide-out calc(var(--tick) * 0.5) var(--ease-instrument) forwards;
}
@media (prefers-reduced-motion: reduce) {
  tr.scm-receiving { animation-duration: 1ms; }
}

/* interaction states */
.scm-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--sp-2); height: 100%; text-align: center; padding: var(--sp-5);
}
.scm-state .scm-state-msg {
  max-width: 26em; line-height: 1.5; font-size: var(--fs-body);
  color: var(--text-secondary);
}
.scm-state .scm-predict { color: var(--accent); font-family: var(--font-mono); }
.scm-error {
  display: flex; align-items: center; gap: var(--sp-3);
  border: 1px solid var(--danger); border-radius: var(--r-card);
  padding: var(--sp-3) var(--sp-4); margin: var(--sp-3);
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}
.scm-error .scm-error-msg { color: var(--danger); font-size: var(--fs-body); flex: 1; }

/* skeleton shimmer (loading) — not a spinner */
.scm-skel {
  border-radius: var(--r-sharp);
  background: linear-gradient(
    100deg,
    var(--bg-inset) 30%,
    color-mix(in srgb, var(--accent) 6%, var(--bg-inset)) 50%,
    var(--bg-inset) 70%
  );
  background-size: 200% 100%;
  animation: scm-shimmer calc(var(--tick) * 1.4) ease-in-out infinite;
}
@keyframes scm-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.scm-skel-card { height: calc(var(--sp-7) + var(--sp-6) + var(--sp-1)); }
.scm-skel-row { height: calc(var(--sp-6) + var(--sp-1)); margin-bottom: 1px; }
@media (prefers-reduced-motion: reduce) {
  .scm-skel { animation: none; }
}

@media (max-width: 1365px) {
  #scm-cards { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 767px) {
  #scm-cards { grid-template-columns: repeat(2, 1fr); }
}
`;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const scm = {
  id: 'scm',
  label: 'SCM',

  init(container, ctx) {
    ensureStyles();
    const t = ctx.t;

    // deterministic data model
    this._suppliers = buildSuppliers();
    this._inTransit = buildInTransit(this._suppliers);
    this._received = [];
    // ids the user has Received/Rejected (removed from in-transit view).
    this._removed = new Set();
    // simulated module fault toggle (ERROR state); flips false on retry.
    this._errored = false;
    // LOADING flag: data is synchronous so this is normally false; QA / the
    // skeleton-conflict resolver (T29) may flip it to exercise the shimmer state.
    this._loading = false;
    this._lastTick = 0;
    this._table = null;
    this._timers = new Set();
    // cross-module focus target (MAT row id), re-stamped on every table rebuild.
    this._focusedRowId = null;

    // scaffold (built once; update() reconciles content) ---------------------
    const root = document.createElement('div');
    root.id = 'scm-root';

    // head
    const head = document.createElement('div');
    head.id = 'scm-head';
    const h1 = document.createElement('h1');
    const enSpan = document.createElement('span');
    enSpan.className = 'en';
    head.appendChild(h1);
    head.appendChild(enSpan);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const tickmeter = document.createElement('span');
    tickmeter.className = 'tickmeter';
    actions.appendChild(tickmeter);
    head.appendChild(actions);
    root.appendChild(head);

    // supplier scorecard panel
    const cardsPanel = document.createElement('section');
    cardsPanel.className = 'card panel scm-panel';
    cardsPanel.dataset.mobile = 'rep'; // T33 <768 representative panel: SCM cards
    const cardsHead = document.createElement('div');
    cardsHead.className = 'panel-head';
    const cardsLabel = document.createElement('span');
    cardsLabel.className = 'label';
    const cardsMeta = document.createElement('span');
    cardsMeta.className = 'meta';
    cardsHead.appendChild(cardsLabel);
    cardsHead.appendChild(cardsMeta);
    const cardsBody = document.createElement('div');
    cardsBody.className = 'panel-body';
    const cardsGrid = document.createElement('div');
    cardsGrid.id = 'scm-cards';
    cardsBody.appendChild(cardsGrid);
    cardsPanel.appendChild(cardsHead);
    cardsPanel.appendChild(cardsBody);
    root.appendChild(cardsPanel);

    // in-transit material panel
    const tablePanel = document.createElement('section');
    tablePanel.className = 'card panel scm-panel';
    tablePanel.dataset.mobile = 'hide'; // T33 <768: in-transit table hidden (rep = cards)
    const tableHead = document.createElement('div');
    tableHead.className = 'panel-head';
    const tableLabel = document.createElement('span');
    tableLabel.className = 'label';
    const tableMeta = document.createElement('span');
    tableMeta.className = 'meta';
    tableHead.appendChild(tableLabel);
    tableHead.appendChild(tableMeta);
    const tableBody = document.createElement('div');
    tableBody.className = 'panel-body';
    const tableHost = document.createElement('div');
    tableHost.id = 'scm-table-host';
    tableBody.appendChild(tableHost);
    tablePanel.appendChild(tableHead);
    tablePanel.appendChild(tableBody);
    root.appendChild(tablePanel);

    container.appendChild(root);

    // keep handles
    this._els = {
      root, h1, enSpan, tickmeter,
      cardsLabel, cardsMeta, cardsGrid,
      tableLabel, tableMeta, tableHost, tableBody,
    };

    // subscriptions (H3): material.in_transit augments the table; po.received
    // confirms a receipt. State-first → idempotent patch via update().
    ctx.dispatcher.subscribeAll(this.id, {
      'material.in_transit': (payload) => this._onInTransit(payload),
      'po.received': (payload) => this._onPoReceived(payload),
    });

    // first paint
    this.update(container, ctx, 0);
  },

  // Map any inbound lotId to one of the deterministic MAT-000N rows the table
  // actually renders. A material.in_transit event carries a lot id (e.g. L-007)
  // that does NOT exist in this module's own in-transit table — the table is
  // keyed MAT-0001..MAT-000N. We fold the lot id onto a real row via fnv1a so
  // the same lot always lands on the same row (deterministic, no Math.random).
  // Returns the MAT row id, or null if there are no rows.
  _matRowForLot(lotId) {
    if (!lotId || !this._inTransit.length) return null;
    const idx = fnv1a(String(lotId)) % this._inTransit.length;
    return this._inTransit[idx].id;
  },

  // event handler: a live in-transit material event. Mutate state first, then
  // patch incrementally (full reconcile happens on the next tick update).
  // We do NOT mint phantom EVT- rows (they were never focusable — the cross-
  // module nav highlight keys on the rendered MAT-000N rows). Instead we map
  // the event's lot onto its deterministic MAT row and surface that row now so
  // the chip → SCM navigation always lands on a visible, highlightable row.
  _onInTransit(payload) {
    if (!payload || !payload.lotId) return;
    const matId = this._matRowForLot(payload.lotId);
    if (!matId) return;
    const row = this._inTransit.find((r) => r.id === matId);
    if (!row || this._removed.has(matId)) return;
    // ensure the mapped row is visible at/after the current tick so a chip that
    // fired before this row's natural arriveTick still has a row to focus.
    if (row.arriveTick > this._lastTick) row.arriveTick = this._lastTick;
    if (this._table) this._refreshTable(this._lastTick);
  },

  _onPoReceived(payload) {
    // A received PO confirms in-transit lots from that supplier may land; we
    // simply re-render so newly-arrived (by tick) rows surface. Deterministic.
    if (this._table) this._refreshTable(this._lastTick);
  },

  // currently-visible in-transit rows: arrived by tick AND not user-removed.
  _visibleInTransit(tick) {
    return this._inTransit.filter(
      (r) => !this._removed.has(r.id) && r.arriveTick <= tick,
    );
  },

  // Receive: slide the row out (token-timed), then move it to received + Toast.
  _receive(row, ctx) {
    const t = ctx.t;
    const tr = this._els.tableHost.querySelector(`tr[data-rowid="${row.id}"]`);
    const commit = () => {
      if (this._removed.has(row.id)) return;
      this._removed.add(row.id);
      this._received.push(Object.assign({}, row, { status: 'received' }));
      this._refreshTable(this._lastTick);
    };
    if (tr) {
      tr.classList.add('scm-receiving');
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        commit();
      };
      tr.addEventListener('animationend', finish, { once: true });
      // fallback timer in case animationend never fires (reduced-motion / detach)
      const timer = setTimeout(finish, 560);
      this._timers.add(timer);
    } else {
      commit();
    }
    Toast({
      message: primaryHalf(t('scm.action.receive')) + ' · ' + row.id,
      type: 'success',
      duration: 3000,
    });
  },

  _reject(row, ctx) {
    const t = ctx.t;
    this._removed.add(row.id);
    this._refreshTable(this._lastTick);
    Toast({
      message: primaryHalf(t('scm.action.reject')) + ' · ' + row.id,
      type: 'warn',
      duration: 3000,
    });
  },

  _escalate(row, ctx) {
    const t = ctx.t;
    Toast({
      message: primaryHalf(t('scm.action.escalate')) + ' · ' + row.id,
      type: 'alarm',
      assertive: true,
      duration: 3000,
    });
  },

  // (re)build the in-transit Table for the current tick / state.
  _refreshTable(tick) {
    const host = this._els && this._els.tableHost;
    if (!host) return;
    const ctx = this._ctx;
    const t = ctx.t;
    const rows = this._visibleInTransit(tick);

    // empty / partial copy lives in the table host when there are no rows.
    if (rows.length === 0) {
      if (this._table) { this._table.destroy(); this._table = null; }
      host.replaceChildren(this._emptyBlock(tick, ctx));
      return;
    }

    const columns = [
      { key: 'id', label: 'Lot ID', num: true, sortable: true },
      { key: 'supplier', label: 'Supplier', num: true, sortable: true },
      { key: 'material', label: 'Material', sortable: true },
      { key: 'qty', label: 'Qty', num: true, sortable: true },
      { key: 'etaTick', label: 'ETA', num: true, sortable: true,
        render: (v) => 'tick ' + String(v).padStart(3, '0') },
      { key: 'status', label: 'Status',
        render: () => {
          const wrap = document.createElement('span');
          const led = document.createElement('i');
          led.className = 'led led-run';
          wrap.appendChild(led);
          wrap.appendChild(document.createTextNode(' ' + primaryHalf(t('scm.material_in_transit'))));
          return wrap;
        } },
      { key: '_actions', label: '', sortable: false,
        render: (_v, r) => this._actionCell(r, ctx) },
    ];

    if (!this._table) {
      this._table = Table({
        columns,
        rows,
        sortable: true,
        rowHeight: 36,
        ariaLabel: primaryHalf(t('scm.material_in_transit')),
      });
      host.replaceChildren(this._table.el);
      this._tagRowIds();
    } else {
      // rebuild to refresh render closures referencing latest ctx/tick
      this._table.destroy();
      this._table = Table({
        columns,
        rows,
        sortable: true,
        rowHeight: 36,
        ariaLabel: primaryHalf(t('scm.material_in_transit')),
      });
      host.replaceChildren(this._table.el);
      this._tagRowIds();
    }
  },

  // tag each rendered <tr> with its lot id for the slide-out animation target.
  // Also re-apply the cross-module focus highlight: _refreshTable destroys and
  // rebuilds the Table every tick, which would otherwise wipe the .scm-row-focus
  // class one tick after a chip navigation. We persist the focused row id and
  // re-stamp it here so the highlight sticks until the user navigates away.
  _tagRowIds() {
    const host = this._els.tableHost;
    const trs = host.querySelectorAll('tbody tr');
    const rows = this._visibleInTransit(this._lastTick);
    let idx = 0;
    trs.forEach((tr) => {
      if (tr.classList.contains('vtable-pad')) return;
      const row = rows[idx++];
      if (row) tr.setAttribute('data-rowid', row.id);
      if (row && this._focusedRowId && row.id === this._focusedRowId) {
        tr.classList.add('scm-row-focus');
      }
    });
  },

  _actionCell(row, ctx) {
    const wrap = document.createElement('span');
    wrap.className = 'scm-row-actions';
    wrap.appendChild(Button({
      i18nKey: 'scm.action.receive', variant: 'primary',
      onClick: () => this._receive(row, ctx),
    }));
    wrap.appendChild(Button({
      i18nKey: 'scm.action.reject', variant: 'ghost',
      onClick: () => this._reject(row, ctx),
    }));
    wrap.appendChild(Button({
      i18nKey: 'scm.action.escalate', variant: 'ghost',
      onClick: () => this._escalate(row, ctx),
    }));
    return wrap;
  },

  // EMPTY-state block: warm copy + deterministic tick forecast.
  _emptyBlock(tick, ctx) {
    const t = ctx.t;
    const block = document.createElement('div');
    block.className = 'scm-state';
    const msg = document.createElement('div');
    msg.className = 'scm-state-msg';
    msg.textContent = primaryHalf(t('states.scm.empty'));
    block.appendChild(msg);
    // deterministic forecast: first material lands at FIRST_ARRIVAL_TICK.
    const predict = document.createElement('div');
    predict.className = 'scm-predict';
    const eta = Math.max(FIRST_ARRIVAL_TICK, tick + 1);
    predict.textContent = '~tick ' + String(eta).padStart(3, '0');
    block.appendChild(predict);
    return block;
  },

  // LOADING-state skeleton shimmer (not a spinner) — supplier cards + table rows.
  _renderLoading() {
    const els = this._els;
    if (els.cardsMeta) els.cardsMeta.textContent = '';
    if (els.tableMeta) els.tableMeta.textContent = '';
    // shimmer supplier cards
    const grid = els.cardsGrid;
    grid.replaceChildren();
    for (let i = 0; i < SUPPLIER_COUNT; i++) {
      const sk = document.createElement('div');
      sk.className = 'scm-card scm-skel scm-skel-card';
      grid.appendChild(sk);
    }
    // shimmer table rows
    const host = els.tableHost;
    if (this._table) { this._table.destroy(); this._table = null; }
    const wrap = document.createElement('div');
    for (let i = 0; i < 10; i++) {
      const r = document.createElement('div');
      r.className = 'scm-skel scm-skel-row';
      wrap.appendChild(r);
    }
    host.replaceChildren(wrap);
  },

  // ERROR-state inline banner (boot vocabulary) + retry.
  _renderError(ctx) {
    const t = ctx.t;
    const els = this._els;
    const block = document.createElement('div');
    block.className = 'scm-error';
    const led = document.createElement('i');
    led.className = 'led led-danger';
    block.appendChild(led);
    const msg = document.createElement('span');
    msg.className = 'scm-error-msg';
    msg.textContent = primaryHalf(t('states.error'));
    block.appendChild(msg);
    block.appendChild(Button({
      i18nKey: 'states.action.retry', variant: 'primary',
      onClick: () => {
        this._errored = false;
        this.update(els.root.parentNode, ctx, this._lastTick);
      },
    }));
    els.tableHost.replaceChildren(block);
    els.cardsGrid.replaceChildren();
  },

  // full reconcile — re-reads t() at every render (6A). Owns the DOM (2B).
  update(container, ctx, tick) {
    this._ctx = ctx;
    if (typeof tick === 'number') this._lastTick = tick;
    const t = ctx.t;
    const els = this._els;
    if (!els) return;

    // head text (re-pull i18n every render)
    const title = t('scm.title');
    els.h1.textContent = primaryHalf(title);
    els.enSpan.textContent = '/ ' + enHalf(title);
    els.tickmeter.innerHTML = '';
    els.tickmeter.appendChild(document.createTextNode('tick '));
    const b = document.createElement('b');
    b.className = 'num';
    b.textContent = String(this._lastTick).padStart(3, '0');
    els.tickmeter.appendChild(b);

    els.cardsLabel.textContent = primaryHalf(t('scm.supplier_scorecard'));
    els.tableLabel.textContent = primaryHalf(t('scm.material_in_transit'));

    if (this._errored) {
      this._renderError(ctx);
      return;
    }

    if (this._loading) {
      this._renderLoading();
      return;
    }

    // supplier scorecard cards
    this._renderCards(ctx);

    // in-transit table / empty state
    const visible = this._visibleInTransit(this._lastTick);
    els.cardsMeta.textContent = this._suppliers.length + ' suppliers';
    els.tableMeta.textContent = visible.length + ' in transit · ' + this._received.length + ' received';
    this._refreshTable(this._lastTick);

    // T24 cross-cutting focus: a material.in_transit chip (or any nav carrying a
    // lotId) highlights the in-transit row it maps to. ctx.focus is the router's
    // one-shot payload — it is stamped BEFORE this module mounts and survives the
    // first update() here, so a chip clicked while SCM is on another module still
    // lands its highlight on first paint. One-shot (router clears it afterwards).
    const focus = ctx.focus;
    if (focus && focus.lotId) this._focusRow(focus.lotId);
  },

  // T24: highlight + scroll a focused in-transit row (cross-module nav target).
  // The chip's lotId (e.g. L-007) is not a row key; rows are MAT-000N. Resolve
  // the lotId to its deterministic MAT row, then also surface that row (it may
  // not have arrived by tick yet) so the highlight has a target. Falls back to a
  // direct id match so a nav that already carries a MAT id still works.
  _focusRow(lotId) {
    const host = this._els && this._els.tableHost;
    if (!host) return;
    const matId = this._matRowForLot(lotId);
    const candidates = [matId, lotId].filter(Boolean);
    // Resolve to a concrete row; ensure it is visible before highlighting.
    const row = this._inTransit.find((r) => candidates.indexOf(r.id) >= 0);
    if (!row || this._removed.has(row.id)) return;
    if (row.arriveTick > this._lastTick) row.arriveTick = this._lastTick;
    // Persist the target so per-tick table rebuilds re-stamp it (_tagRowIds).
    this._focusedRowId = row.id;
    this._refreshTable(this._lastTick); // rebuild → _tagRowIds applies the class
    // scroll the freshly-stamped row into view.
    const tr = host.querySelector(`tr[data-rowid="${row.id}"]`);
    if (tr && typeof tr.scrollIntoView === 'function') {
      try { tr.scrollIntoView({ block: 'nearest' }); } catch (_) { /* defensive */ }
    }
  },

  _renderCards(ctx) {
    const t = ctx.t;
    const grid = this._els.cardsGrid;
    grid.replaceChildren();
    for (const s of this._suppliers) {
      const card = document.createElement('div');
      card.className = 'scm-card';

      const top = document.createElement('div');
      top.className = 'scm-card-top';
      const sid = document.createElement('span');
      sid.className = 'scm-sid';
      sid.textContent = s.id;
      top.appendChild(sid);
      // overall grade LED = min of on-time / quality bands
      const led = ledFor(Math.min(s.onTime, s.quality), 90, 82);
      const grade = document.createElement('span');
      grade.className = 'scm-grade';
      const ledI = document.createElement('i');
      ledI.className = 'led ' + led.cls;
      grade.appendChild(ledI);
      grade.appendChild(document.createTextNode(' ' + led.shape));
      top.appendChild(grade);
      card.appendChild(top);

      const group = document.createElement('div');
      group.className = 'scm-group';
      group.textContent = s.groupName;
      card.appendChild(group);

      const metrics = document.createElement('div');
      metrics.className = 'scm-metrics';
      metrics.appendChild(this._metricRow('On-time', s.onTime.toFixed(1) + '%'));
      metrics.appendChild(this._metricRow('Quality', s.quality.toFixed(1)));
      metrics.appendChild(this._metricRow('Lead', s.leadTime + 'd'));
      card.appendChild(metrics);

      grid.appendChild(card);
    }
  },

  _metricRow(label, value) {
    const row = document.createElement('div');
    row.className = 'scm-metric';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'num';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  },

  destroy() {
    // clear timers
    if (this._timers) {
      for (const tm of this._timers) clearTimeout(tm);
      this._timers.clear();
    }
    // chart-kit / d3 interrupt + table teardown
    if (this._table) {
      try { this._table.destroy(); } catch (_e) { /* noop */ }
      this._table = null;
    }
    const d3 = (typeof window !== 'undefined' && window.__SIM && window.__SIM.d3) || null;
    if (d3 && this._els && this._els.root) {
      try { d3.select(this._els.root).selectAll('*').interrupt(); } catch (_e) { /* noop */ }
    }
    // unsubscribe everything we registered
    if (this._ctx && this._ctx.dispatcher) {
      this._ctx.dispatcher.unsubscribeAll(this.id);
    }
    // remove DOM
    if (this._els && this._els.root) this._els.root.remove();
    this._els = null;
    this._ctx = null;
  },
};

export default scm;
