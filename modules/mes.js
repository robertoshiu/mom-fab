// modules/mes.js — MES (Manufacturing Execution System) module (T15).
//
// Module contract (T13): default export { id, label, init, update, destroy }.
//   ctx = { state, dispatcher, t, router }.
//
// Layout (instrument-grade, reference-spc.html composition):
//   ┌ .panel ─ Lot 追蹤表 (Table component: sortable/filterable/virtual) ──┐
//   │   .panel-head engraved label + action button toolbar                 │
//   │   .panel-body → Table (fixed 36px rows, M6)                          │
//   ├ .panel ─ 選中 lot 生命週期 Gantt (chart-kit createGantt) ───────────┤
//   └──────────────────────────────────────────────────────────────────────┘
//
// Data source: the lot lifecycle skeleton is REGENERATED locally from
// state.lots/equipment/recipes (generateSkeleton is deterministic — identical
// inputs yield a JSON-identical skeleton, so this matches app.js's instance).
// getLotAtTick(skeleton, lotId, tick) drives both the table's live status and
// the selected lot's Gantt; lot.route supplies the full planned step sequence.
//
// Actions (T29 state-write contract — the event-gate suppression itself is T29
// Wave 5; here we own the state writes + UI):
//   Hold     → state.setOverride(lotId, 'hold', currentTick + 30) + updateLot
//   Release  → state.clearOverride(lotId) + updateLot(status:'running')
//   Scrap    → state.setOverride(lotId, 'scrap', Infinity) + updateLot
//   Complete → state.setOverride(lotId, 'complete', Infinity) + updateLot
//   Start    → updateLot(status:'running')
//   Rework   → updateLot(status:'rework')
// Every action raises a Toast.
//
// 2B rendering ownership: event callbacks mutate state first then do an
// idempotent incremental patch (re-stamp the selected row's status cell);
// update() does the full reconcile and re-reads t() at every render (6A).
//
// Styling: token-only injected <style data-module="mes">; 1px hairlines allowed.

import { Table } from '../components/table.js';
import { Button } from '../components/button.js';
import { Toast } from '../components/toast.js';
import { createGantt } from '../components/chart-kit.js';
import { generateSkeleton, getLotAtTick } from '../engine/skeleton.js';
import { fnv1a } from '../engine/prng.js';

const STYLE_ID = 'mes-module-styles';
const HOLD_TICKS = 30; // T29: Hold lasts until currentTick + 30
const FIRST_LOT_TICK = 3; // EMPTY-state deterministic forecast (matrix row MES)

// Deterministic operator name per lot (no Math.random — fnv1a over lotId).
const OPERATORS = ['A. Chen', 'B. Lin', 'C. Wu', 'D. Kao', 'E. Hsu', 'F. Yeh'];
function operatorFor(lotId) {
  return OPERATORS[fnv1a('operator:' + lotId) % OPERATORS.length];
}

// Token-only module stylesheet. Injected once; shared by every MES mount.
const CSS = `
#content .mes-root {
  display: grid;
  grid-template-rows: 1.35fr 1fr;
  gap: var(--sp-3);
  height: 100%;
  min-height: 0;
}
#content .mes-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
#content .mes-panel-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--hairline);
  flex: 0 0 auto;
}
#content .mes-panel-head .meta {
  margin-left: auto;
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
}
#content .mes-actions {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
#content .mes-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
#content .mes-panel-body .vtable { flex: 1 1 auto; min-height: 0; }
#content .mes-gantt {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--sp-2) var(--sp-3);
}
#content .mes-state {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--sp-5);
}
#content .mes-state .mes-state-msg {
  max-width: 28em;
  line-height: 1.6;
  color: var(--text-secondary);
  font-size: var(--fs-body);
}
#content .mes-state .mes-state-predict {
  color: var(--accent);
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  margin-top: var(--sp-2);
}
#content .mes-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  text-align: center;
  padding: var(--sp-5);
}
#content tr.mes-row-selected td { background: var(--accent-dim, rgba(0,212,255,0.10)); }
#content .mes-status-cell { display: inline-flex; align-items: center; gap: var(--sp-2); white-space: nowrap; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.setAttribute('data-module', 'mes');
  el.textContent = CSS;
  doc.head.appendChild(el);
}

// Status → LED class + badge class (color + shape dual-encoding, 6A).
function ledClassFor(status) {
  if (status === 'hold' || status === 'scrap') return 'led-danger';
  if (status === 'rework') return 'led-warn';
  if (status === 'complete' || status === 'shipped') return 'led-ok';
  return 'led-run';
}
function statusI18nKey(status) {
  // Reuse the action-vocabulary keys where they map cleanly; fall back to raw.
  switch (status) {
    case 'hold': return 'mes.action.hold';
    case 'complete': return 'mes.action.complete';
    case 'scrap': return 'mes.action.scrap';
    case 'rework': return 'mes.action.rework';
    default: return null;
  }
}

const mes = {
  id: 'mes',
  label: 'MES',

  init(container, ctx) {
    const doc = container.ownerDocument || document;
    ensureStyles(doc);
    const { state, t } = ctx;

    // Local deterministic skeleton (matches app.js's instance — same inputs).
    this._skeleton = generateSkeleton(state.lots, state.equipment, state.recipes);

    this._selectedLotId = null;
    this._lastTick = 0;
    this._tableRows = [];
    this._statusByLot = new Map(); // lotId -> resolved status string (for incremental patch)

    // --- root scaffold ------------------------------------------------------
    const root = doc.createElement('div');
    root.className = 'mes-root';

    // === TOP PANEL: Lot tracking table ===
    const topPanel = doc.createElement('div');
    topPanel.className = 'panel mes-panel';
    topPanel.dataset.mobile = 'rep'; // T33 <768 representative panel: MES table
    topPanel.dataset.tour = 'mes.lot-table'; // guided-tour anchor (M2)

    const head = doc.createElement('div');
    head.className = 'mes-panel-head';
    const headLabel = doc.createElement('span');
    headLabel.className = 'label';
    headLabel.setAttribute('data-i18n', 'mes.title');
    headLabel.textContent = t('mes.title');
    head.appendChild(headLabel);

    // action toolbar (Start/Hold/Release/Complete/Rework/Scrap)
    // T33: flagged .mobile-actions so the operation buttons collapse to a
    // common.desktop_only notice below 768px (no fake interactivity).
    const actions = doc.createElement('div');
    actions.className = 'mes-actions mobile-actions';
    this._buttons = {};
    const ACTIONS = [
      ['start', 'mes.action.start', 'default'],
      ['hold', 'mes.action.hold', 'default'],
      ['release', 'mes.action.release', 'default'],
      ['complete', 'mes.action.complete', 'primary'],
      ['rework', 'mes.action.rework', 'default'],
      ['scrap', 'mes.action.scrap', 'default'],
    ];
    for (const [action, key, variant] of ACTIONS) {
      const btn = Button({
        i18nKey: key,
        variant,
        disabled: true,
        onClick: () => this._runAction(action, ctx),
      });
      this._buttons[action] = btn;
      actions.appendChild(btn);
    }
    // T33 <768 desktop-only notice (shown by responsive.css when buttons hide).
    const dtOnly = doc.createElement('span');
    dtOnly.className = 'mobile-desktop-only';
    dtOnly.setAttribute('data-i18n', 'common.desktop_only');
    dtOnly.textContent = t('common.desktop_only');
    actions.appendChild(dtOnly);
    head.appendChild(actions);

    const meta = doc.createElement('span');
    meta.className = 'meta';
    meta.id = 'mes-table-meta';
    head.appendChild(meta);
    this._tableMeta = meta;

    topPanel.appendChild(head);

    const topBody = doc.createElement('div');
    topBody.className = 'mes-panel-body';
    topBody.id = 'mes-table-host';
    topPanel.appendChild(topBody);
    this._tableHost = topBody;

    // === BOTTOM PANEL: selected lot lifecycle Gantt ===
    const botPanel = doc.createElement('div');
    botPanel.className = 'panel mes-panel';
    botPanel.dataset.mobile = 'hide'; // T33 <768: not the representative panel
    botPanel.dataset.tour = 'mes.gantt'; // guided-tour anchor (M2)

    const botHead = doc.createElement('div');
    botHead.className = 'mes-panel-head';
    const botLabel = doc.createElement('span');
    botLabel.className = 'label';
    botLabel.id = 'mes-gantt-label';
    botLabel.textContent = t('wip.gantt');
    botHead.appendChild(botLabel);
    const botMeta = doc.createElement('span');
    botMeta.className = 'meta';
    botMeta.id = 'mes-gantt-meta';
    botHead.appendChild(botMeta);
    this._ganttLabel = botLabel;
    this._ganttMeta = botMeta;
    botPanel.appendChild(botHead);

    const ganttHost = doc.createElement('div');
    ganttHost.className = 'mes-gantt';
    ganttHost.id = 'mes-gantt-host';
    botPanel.appendChild(ganttHost);
    this._ganttHost = ganttHost;

    root.appendChild(topPanel);
    root.appendChild(botPanel);
    container.appendChild(root);
    this._root = root;

    // --- subscriptions (lot.start / lot.complete / step.transition) --------
    // State-first: app.js already folds these into lot.status; here we just
    // mark the view dirty so the next update() (or an immediate light patch)
    // reflects the change. We do NOT double-write status (app.js owns that).
    this._dirty = true;
    this._recipeRev = null; // I2: latest signed-off recipe (recipeId · vN)
    ctx.dispatcher.subscribeAll(this.id, {
      'lot.start': () => { this._dirty = true; },
      'lot.complete': () => { this._dirty = true; },
      'step.transition': () => { this._dirty = true; },
      // I2 chain: a recipe sign-off (Recipe module → recipe.changed) updates the
      // route's current-step recipe. State-first: stash the new revision; the
      // next update() stamps it into the selected lot's Gantt meta (the visible
      // "current step recipe" indicator). Idempotent — re-reads on every render.
      'recipe.changed': (p) => {
        this._recipeRev = p && p.recipeId
          ? p.recipeId + ' · v' + (p.version != null ? p.version : '?')
          : null;
        this._dirty = true;
      },
    });

    // --- build the Gantt (chart-kit factory) -------------------------------
    this._gantt = createGantt({
      partialCapacity: 180,
      ariaLabel: t('wip.gantt'),
      emptyI18nKey: 'states.empty',
    });
    this._gantt.render(ganttHost);

    // Initial reconcile (catch up to whatever tick the router last drove).
    this.update(container, ctx, this._lastTick);
  },

  // -------------------------------------------------------------------------
  // Resolve the live status of a lot at the current tick. Precedence:
  //   user override (hold/scrap/complete) > authoritative lot.status >
  //   skeleton replay (running/complete) > 'queued' (not yet started).
  // -------------------------------------------------------------------------
  _resolveLot(state, lotId, tick) {
    const lot = state.lots.get(lotId);
    const replay = getLotAtTick(this._skeleton, lotId, tick); // null until started
    const override = state.suppressOverrides.get(lotId);

    let status;
    let currentStep = replay ? replay.currentStep : null;
    let currentEquipment = replay ? replay.currentEquipment : null;
    let qTime = replay ? replay.qTime : 0;

    if (override) {
      // hold expires at override.until; scrap/complete are terminal (Infinity).
      if (override.status === 'hold' && tick >= override.until) {
        status = 'running';
      } else {
        status = override.status;
      }
    } else if (lot && (lot.status === 'complete' || lot.status === 'shipped')) {
      status = lot.status;
    } else if (replay) {
      status = replay.status; // running | complete
    } else {
      status = 'queued';
    }

    if (status === 'queued') qTime = 0;

    return {
      id: lotId,
      product: lot ? lot.product : '',
      currentStep: currentStep || '—',
      currentEquipment: currentEquipment || '—',
      status,
      qTime,
      operator: operatorFor(lotId),
    };
  },

  // Has any lot started by this tick? (drives EMPTY vs SUCCESS/PARTIAL).
  _startedCount(state, tick) {
    let n = 0;
    for (const lotId of state.lots.keys()) {
      if (getLotAtTick(this._skeleton, lotId, tick)) n++;
    }
    return n;
  },

  // -------------------------------------------------------------------------
  // Full reconcile (2B). Re-reads t() at every render (6A). Decides which of
  // the five interaction states to show (LOADING handled by chart-kit; ERROR
  // is defensive; EMPTY/PARTIAL/SUCCESS are tick-driven).
  // -------------------------------------------------------------------------
  update(container, ctx, tick) {
    if (typeof tick === 'number') this._lastTick = tick;
    const t = ctx.t;
    const { state } = ctx;
    const now = this._lastTick;

    // I2 chain: pick up a recipe sign-off that landed while MES was unmounted
    // (app.js's recipe-bridge persists the latest onto shared state). The live
    // subscription handles changes while MES is on screen; this covers the rest.
    if (!this._recipeRev && state && state.lastRecipeChange && state.lastRecipeChange.recipeId) {
      const rc = state.lastRecipeChange;
      this._recipeRev = rc.recipeId + ' · v' + (rc.version != null ? rc.version : '?');
    }

    // refresh engraved labels + button labels (locale change, 6A)
    if (this._ganttLabel) this._ganttLabel.textContent = t('wip.gantt');

    const totalLots = state.lots.size;
    const started = this._startedCount(state, now);

    // ---- EMPTY: nothing in-process yet → warm copy + deterministic forecast
    if (started === 0) {
      this._renderEmpty(container, ctx);
      this._setActionsEnabled(false);
      return;
    }

    // ---- build rows for every lot (full population) -----------------------
    const rows = [];
    this._statusByLot.clear();
    for (const lotId of state.lots.keys()) {
      const row = this._resolveLot(state, lotId, now);
      rows.push(row);
      this._statusByLot.set(lotId, row.status);
    }
    this._tableRows = rows;

    // PARTIAL when fewer than the full lot set has entered the line; the table
    // shows the started lots, the Gantt axis is left-anchored (partialCapacity).
    const partial = started < totalLots;

    this._ensureTable(ctx);
    this._table.update({ rows });

    // T24 cross-cutting focus: a lot.start / lot.complete / step.transition chip
    // (or any nav carrying a lotId) selects + highlights that lot's row. One-shot
    // (router clears ctx.focus after this first update), so it never re-fires on
    // a later per-tick reconcile. We only honour it if the lot is actually shown.
    const focus = ctx.focus;
    if (focus && focus.lotId && this._statusByLot.has(focus.lotId)) {
      this._selectedLotId = focus.lotId;
      this._scrollSelectedIntoView = true;
    }

    this._reselectRow();

    // table meta line
    if (this._tableMeta) {
      this._tableMeta.textContent =
        `${started}/${totalLots} · tick ${String(now).padStart(3, '0')}` +
        (partial ? ` · ${t('states.partial')}` : '');
    }

    // ---- Gantt for the selected lot ---------------------------------------
    this._renderGantt(ctx, now);

    // ---- action button enablement -----------------------------------------
    this._setActionsEnabled(!!this._selectedLotId);
    this._dirty = false;
  },

  // Mount/replace the inline EMPTY state (matrix row MES: warm copy + tick).
  _renderEmpty(container, ctx) {
    const t = ctx.t;
    // tear down a live table/gantt host content but keep panels.
    if (this._table) { this._table.destroy(); this._table = null; }
    if (this._tableHost) {
      this._tableHost.replaceChildren();
      const wrap = (container.ownerDocument || document).createElement('div');
      wrap.className = 'mes-state';
      const msg = (container.ownerDocument || document).createElement('div');
      msg.className = 'mes-state-msg';
      msg.setAttribute('data-i18n', 'states.mes.empty');
      msg.textContent = t('states.mes.empty');
      const pred = (container.ownerDocument || document).createElement('div');
      pred.className = 'mes-state-predict';
      pred.textContent = `~ tick ${FIRST_LOT_TICK}`;
      msg.appendChild(pred);
      wrap.appendChild(msg);
      this._tableHost.appendChild(wrap);
    }
    if (this._gantt) this._gantt.update([]);
    if (this._tableMeta) this._tableMeta.textContent = '';
  },

  // Lazily build the Table once we have data; reuse across ticks (update only).
  _ensureTable(ctx) {
    if (this._table && this._tableHost.contains(this._table.el)) return;
    const t = ctx.t;
    if (this._tableHost) this._tableHost.replaceChildren();

    const columns = [
      { key: 'id', labelI18nKey: 'mes.lot_id', sortable: true },
      { key: 'product', labelI18nKey: 'mes.product', sortable: true },
      { key: 'currentStep', labelI18nKey: 'mes.step', sortable: true },
      {
        key: 'currentEquipment',
        labelI18nKey: 'aps.equipment_load',
        sortable: true,
      },
      {
        key: 'status',
        labelI18nKey: 'mes.lot_status',
        sortable: true,
        render: (value) => this._statusCell(value, t),
      },
      { key: 'qTime', labelI18nKey: 'wip.queue_length', sortable: true, num: true },
      { key: 'operator', label: 'Operator', sortable: true },
    ];

    this._table = Table({
      columns,
      rows: this._tableRows,
      sortable: true,
      filterable: true,
      virtual: true,
      rowHeight: 36,
      ariaLabel: t('mes.title'),
      onRowClick: (row) => this._selectLot(row.id, ctx),
    });
    this._tableHost.appendChild(this._table.el);
  },

  // Status cell: LED (color+shape dual-encoding) + localized label.
  _statusCell(status, t) {
    const doc = document;
    const span = doc.createElement('span');
    span.className = 'mes-status-cell';
    span.dataset.status = status;
    const led = doc.createElement('i');
    led.className = 'led ' + ledClassFor(status);
    span.appendChild(led);
    const text = doc.createElement('span');
    const key = statusI18nKey(status);
    text.textContent = key ? t(key) : status;
    span.appendChild(text);
    return span;
  },

  _selectLot(lotId, ctx) {
    this._selectedLotId = lotId;
    this._reselectRow();
    this._setActionsEnabled(true);
    this._renderGantt(ctx, this._lastTick);
  },

  // Idempotent incremental patch (2B): highlight the selected row's <tr>.
  _reselectRow() {
    if (!this._table || !this._table.el) return;
    const rows = this._table.el.querySelectorAll('tbody tr');
    rows.forEach((tr) => tr.classList.remove('mes-row-selected'));
    if (!this._selectedLotId) return;
    rows.forEach((tr) => {
      const firstCell = tr.querySelector('td');
      if (firstCell && firstCell.textContent === this._selectedLotId) {
        tr.classList.add('mes-row-selected');
        // T24 focus: bring a chip-targeted row into view (virtual table may have
        // it off-screen). One-shot — cleared after we honour it.
        if (this._scrollSelectedIntoView && typeof tr.scrollIntoView === 'function') {
          try { tr.scrollIntoView({ block: 'nearest' }); } catch (_) { /* defensive */ }
        }
      }
    });
    this._scrollSelectedIntoView = false;
  },

  // Build the selected lot's lifecycle Gantt from lot.route + skeleton events.
  // One Gantt "row" = one route step; blocks span the planned tick window of
  // each step, status-colored by past/current/future relative to `tick`.
  _renderGantt(ctx, tick) {
    const { state, t } = ctx;
    if (!this._gantt) return;
    const lotId = this._selectedLotId;
    if (!lotId) {
      this._gantt.update([]);
      if (this._ganttMeta) this._ganttMeta.textContent = '';
      if (this._ganttLabel) this._ganttLabel.textContent = t('wip.gantt');
      return;
    }
    const lot = state.lots.get(lotId);
    if (!lot) { this._gantt.update([]); return; }

    // Collect this lot's skeleton events (start, transitions, complete) in tick
    // order to derive per-step start/end windows along the 180-tick epoch.
    const evs = [];
    for (let ti = 0; ti < this._skeleton.length; ti++) {
      const slot = this._skeleton[ti];
      for (const ev of slot.events) {
        if (ev.lotId === lotId) evs.push(ev);
      }
    }
    evs.sort((a, b) => a.tick - b.tick);

    const live = getLotAtTick(this._skeleton, lotId, tick);
    const currentStep = live ? live.currentStep : null;

    // Walk events: each segment between consecutive events is the step that was
    // active at the earlier event. Label rows by step id.
    const data = [];
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const p = ev.payload || {};
      let stepId = null;
      if (ev.type === 'lot.start') stepId = p.step;
      else if (ev.type === 'step.transition') stepId = p.toStep;
      else if (ev.type === 'lot.complete') stepId = p.step;
      if (!stepId) continue;
      const start = ev.tick;
      const end = i + 1 < evs.length ? evs[i + 1].tick : ev.tick + 1;
      let status;
      if (end <= tick) status = 'done';
      else if (start <= tick && tick < end) status = stepId === currentStep ? 'accent' : 'accent';
      else status = 'queued';
      // override coloring: held/scrapped lots flag the live block
      const ov = state.suppressOverrides.get(lotId);
      if (ov && (ov.status === 'hold' || ov.status === 'scrap') && start <= tick && tick < end) {
        status = 'hold';
      }
      data.push({ row: stepId, label: `${stepId} · t${start}`, start, end, status });
    }

    this._gantt.update(data);
    if (this._ganttLabel) {
      this._ganttLabel.textContent = `${t('wip.gantt')} — ${lotId}`;
    }
    if (this._ganttMeta) {
      // I2: when a recipe has been signed off, surface its revision next to the
      // route so the "current-step recipe" is visibly current.
      const rev = this._recipeRev ? ` · ${this._recipeRev}` : '';
      this._ganttMeta.textContent =
        `${lot.product} · ${data.length} steps · tick ${String(tick).padStart(3, '0')}${rev}`;
    }
  },

  _setActionsEnabled(enabled) {
    if (!this._buttons) return;
    for (const k in this._buttons) {
      this._buttons[k].disabled = !enabled;
    }
  },

  // -------------------------------------------------------------------------
  // Action handler (T29 state-write contract). State-first, then Toast, then
  // an idempotent incremental patch of the selected row's status cell (2B).
  // -------------------------------------------------------------------------
  _runAction(action, ctx) {
    const { state, t } = ctx;
    const lotId = this._selectedLotId;
    if (!lotId) return;
    const now = this._lastTick;

    let nextStatus = null;
    let toastType = 'info';

    switch (action) {
      case 'hold':
        state.setOverride(lotId, 'hold', now + HOLD_TICKS);
        state.updateLot(lotId, { status: 'hold' });
        nextStatus = 'hold';
        toastType = 'warn';
        break;
      case 'release':
        state.clearOverride(lotId);
        state.updateLot(lotId, { status: 'running' });
        nextStatus = 'running';
        toastType = 'success';
        break;
      case 'scrap':
        state.setOverride(lotId, 'scrap', Infinity);
        state.updateLot(lotId, { status: 'scrap' });
        nextStatus = 'scrap';
        toastType = 'danger';
        break;
      case 'complete':
        state.setOverride(lotId, 'complete', Infinity);
        state.updateLot(lotId, { status: 'complete' });
        nextStatus = 'complete';
        toastType = 'success';
        break;
      case 'start':
        state.clearOverride(lotId);
        state.updateLot(lotId, { status: 'running' });
        nextStatus = 'running';
        toastType = 'info';
        break;
      case 'rework':
        state.updateLot(lotId, { status: 'rework' });
        nextStatus = 'rework';
        toastType = 'warn';
        break;
      default:
        return;
    }

    // KPIs derive from lot status — keep the strip coherent immediately.
    if (typeof state.recomputeKpis === 'function') state.recomputeKpis();

    // Toast: "<lotId> <Action>" using the localized action label.
    const actionLabel = t('mes.action.' + action);
    Toast({ message: `${lotId} · ${actionLabel}`, type: toastType });

    // Incremental patch: re-stamp the selected row's status cell + cached map
    // so the change is visible before the next tick's full reconcile.
    if (nextStatus) {
      this._statusByLot.set(lotId, nextStatus);
      this._patchStatusCell(lotId, nextStatus, t);
    }
    this._renderGantt(ctx, now);
  },

  // Idempotent DOM patch of a single row's status cell.
  _patchStatusCell(lotId, status, t) {
    if (!this._table || !this._table.el) return;
    const rows = this._table.el.querySelectorAll('tbody tr');
    rows.forEach((tr) => {
      const firstCell = tr.querySelector('td');
      if (!firstCell || firstCell.textContent !== lotId) return;
      const cells = tr.querySelectorAll('td');
      // status is the 5th column (index 4) per the column order in _ensureTable.
      const statusTd = cells[4];
      if (statusTd) {
        statusTd.replaceChildren(this._statusCell(status, t));
      }
    });
  },

  // -------------------------------------------------------------------------
  // destroy() — interrupt running transitions, drop subscriptions, remove DOM.
  // -------------------------------------------------------------------------
  destroy() {
    if (this._gantt) { this._gantt.destroy(); this._gantt = null; }
    if (this._table) { this._table.destroy(); this._table = null; }
    if (this._ctxDispatcher) this._ctxDispatcher.unsubscribeAll(this.id);
    if (this._root && this._root.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
    this._skeleton = null;
    this._tableRows = [];
    this._statusByLot && this._statusByLot.clear();
  },
};

// Capture dispatcher handle for destroy()'s unsubscribeAll (ctx not passed there).
const _origInit = mes.init;
mes.init = function (container, ctx) {
  this._ctxDispatcher = ctx.dispatcher;
  return _origInit.call(this, container, ctx);
};

export default mes;
