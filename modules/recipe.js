// modules/recipe.js — Recipe Management module (T22).
//
// MODULE CONTRACT (T13): default export { id, label, init, update, destroy }.
// ctx = { state, dispatcher, t, router }.
//
// Layout (per design/reference-spc.html .panel grid composition):
//   上半 — 配方參數表 (Parameter Table): selected version's steps
//          (Step / Chamber / Gas / Time / Temp / Pressure) via Table component,
//          fixed 36px rows (M6).
//   下半 — 版本 diff (Version Diff): v1 vs v2 side-by-side, changed rows highlighted
//          amber (the changed cell) / green (the new value).
//
// Actions:
//   New version — creates a deterministic v(N+1) delta off the current head + queues
//                 a pending-approval entry.
//   Sign off    — opens the pending-approval list + signer; on confirm emits
//                 recipe.changed (I2: APC/MES subscribe) + success Toast + state.
//   Compare     — toggles the diff panel between the two latest versions.
//
// Determinism: the v(N+1) delta is derived purely from deriveSeed(namespace,id) —
// no Math.random / Date.now. Same recipe + same version index ⇒ identical delta.
//
// Interaction State Matrix (Recipe row):
//   LOADING — Table component's own skeleton (never reached here: base data is
//             pregenerated synchronously, so we go straight to EMPTY/SUCCESS).
//   EMPTY   — no version yet → warm copy (states.recipe.empty) + deterministic
//             tick forecast + greyed table skeleton.
//   ERROR   — handled by the router's soft-fail panel (init/throw path).
//   PARTIAL — only v1 exists (no v2) → diff panel drawn single-side, faded gridlines.
//   SUCCESS — parameter table + two-sided version diff.
//
// Styling: own <style data-module="recipe"> with token-only values; reuses
// .panel / .panel-head / .label / .table / .badge / .led utilities.

import { Table } from '../components/table.js';
import { Button } from '../components/button.js';
import { Toast } from '../components/toast.js';
import { Dialog } from '../components/dialog.js';
import { createRecipe } from '../engine/factory.js';
import { deriveSeed, mulberry32 } from '../engine/prng.js';
import { toolGroups, products } from '../scenarios/mom-fab.js';

const STYLE_ID = 'recipe-styles';

// Tick at which the first recipe version is guaranteed available for the empty-state
// forecast. The base recipe is pregenerated, so v1 is offered immediately on mount;
// the forecast copy points the operator at the New version action arriving at boot.
const FORECAST_TICK = 0;

// Deterministic param mutators for a new version. Each takes (oldValue, rng) and
// returns a plausible neighbouring value, clamped to the factory's domain ranges.
function mutTemp(v, rng) {
  return clamp(v + Math.round((rng() - 0.5) * 60), 80, 1100);
}
function mutTime(v, rng) {
  return clamp(v + Math.round((rng() - 0.5) * 30), 20, 200);
}
function mutPressure(v, rng) {
  return clamp(v + Math.round((rng() - 0.5) * 80), 5, 760);
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Token-only CSS. The only literals are 1px hairlines (allowed for borders).
const CSS = `
#content .recipe-root {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--sp-3);
  height: 100%;
  min-height: 0;
}
#content .recipe-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
}
#content .recipe-head h1 {
  font-size: var(--fs-title);
  font-weight: var(--fw-emphasis);
  margin: 0;
  letter-spacing: 0.01em;
}
#content .recipe-head .en {
  color: var(--text-secondary);
  font-size: var(--fs-subtitle);
  font-weight: var(--fw-body);
}
#content .recipe-head .actions {
  margin-left: auto;
  display: flex;
  gap: var(--sp-2);
  align-items: center;
}
#content .recipe-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
#content .recipe-panel .panel-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--hairline);
}
#content .recipe-panel .panel-head .meta {
  margin-left: auto;
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
}
#content .recipe-panel .panel-body {
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}
#content .recipe-panel .vtable { width: 100%; min-height: 0; }

/* version diff: two columns sharing one grid */
#content .recipe-diff-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
#content .recipe-diff-col { min-width: 0; }
#content .recipe-diff-col + .recipe-diff-col {
  border-left: 1px solid var(--hairline);
}
#content .recipe-diff-colhead {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--hairline);
}
#content .recipe-diff-table { width: 100%; border-collapse: collapse; }
#content .recipe-diff-table th,
#content .recipe-diff-table td {
  height: 36px;
  padding: var(--sp-1) var(--sp-3);
  text-align: left;
  font-size: var(--fs-body);
  border-bottom: 1px solid var(--grid);
  white-space: nowrap;
}
#content .recipe-diff-table th {
  font: var(--fw-emphasis) var(--fs-caption) var(--font-body);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}
#content .recipe-diff-table td.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
#content .recipe-diff-table tr:nth-child(even) td { background: var(--bg-inset); }

/* changed-cell highlight: amber = removed/old, green = added/new */
#content .recipe-diff-table td.diff-old {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 12%, transparent) !important;
}
#content .recipe-diff-table td.diff-new {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent) !important;
}
#content .recipe-diff-table tr.diff-row td:first-child {
  box-shadow: inset 2px 0 0 var(--accent);
}

/* PARTIAL: single-side diff, faded gridline column */
#content .recipe-diff-col.is-faded { opacity: 0.4; }
#content .recipe-diff-col.is-faded .recipe-diff-colhead { color: var(--text-secondary); }

/* EMPTY: warm copy + greyed table skeleton */
#content .recipe-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  flex: 1;
  text-align: center;
  padding: var(--sp-5);
  color: var(--text-secondary);
}
#content .recipe-empty .recipe-empty-title {
  font-size: var(--fs-body);
  color: var(--text-primary);
}
#content .recipe-empty .recipe-empty-forecast {
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
}
#content .recipe-empty .recipe-skeleton {
  width: 100%;
  max-width: 520px;
  display: grid;
  gap: var(--sp-1);
}
#content .recipe-empty .recipe-skeleton-row {
  height: 36px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-sharp);
  background: var(--bg-inset);
  opacity: 0.5;
}

/* pending-approval list inside the Sign off dialog */
#content .recipe-signoff,
.recipe-signoff {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 320px;
}
.recipe-signoff .recipe-pending-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.recipe-signoff .recipe-pending-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--hairline);
  border-radius: var(--r-card);
  font-size: var(--fs-body);
}
.recipe-signoff .recipe-pending-row .meta {
  margin-left: auto;
  font: var(--fw-body) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
}
.recipe-signoff .recipe-signer {
  font-size: var(--fs-body);
  color: var(--text-secondary);
}
.recipe-signoff .recipe-signer b { color: var(--text-primary); font-weight: var(--fw-emphasis); }
.recipe-signoff .recipe-signoff-actions { display: flex; gap: var(--sp-2); margin-top: var(--sp-1); }

.diff-pill {
  font: var(--fw-emphasis) var(--fs-caption) var(--font-mono);
  color: var(--text-secondary);
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.setAttribute('data-module', 'recipe');
  el.textContent = CSS;
  doc.head.appendChild(el);
}

// Deterministic signer roster (no hardcoded fab/product names — these are people
// roles in the approval workflow, not domain entities).
const SIGNERS = ['Process Eng. Lin', 'Integration Eng. Chen', 'Module Owner Wu'];

// Resolve a base recipe with >=8 steps so the parameter table always has >=8 rows
// (acceptance). Walks the deterministic pregenerated RCP space; falls back to
// building one against the highest-step product if none qualifies.
function resolveBaseRecipe(state) {
  if (state && state.recipes && state.recipes.size) {
    for (const [, r] of state.recipes) {
      if (r && Array.isArray(r.steps) && r.steps.length >= 8) return r;
    }
  }
  // Fallback: build a deterministic recipe against the manifest product with the
  // most steps (no hardcoded product/tool-group ids — all derived from scenarios).
  const richest = products.reduce((a, b) => (b.recipeCount > a.recipeCount ? b : a), products[0]);
  return createRecipe('RCP-001', { id: richest.id });
}

// Build version N+1 from version N: a deterministic subset of steps is mutated.
function deriveNextVersion(baseRecipe, prevVersion) {
  const nextN = prevVersion.version + 1;
  const seed = deriveSeed('recipe-delta', baseRecipe.id + ':v' + nextN);
  const rng = mulberry32(seed);
  // Mutate a deterministic ~third of the steps; rotate which fields change.
  const steps = prevVersion.steps.map((s, i) => {
    const changeThis = (((seed >>> i) ^ i) & 0x3) === 0; // ~1/4..1/3 of rows
    if (!changeThis) return Object.assign({}, s);
    const field = ['temp', 'time', 'pressure'][(seed + i) % 3];
    const next = Object.assign({}, s);
    if (field === 'temp') next.temp = mutTemp(s.temp, rng);
    else if (field === 'time') next.time = mutTime(s.time, rng);
    else next.pressure = mutPressure(s.pressure, rng);
    return next;
  });
  return { version: nextN, steps };
}

function v1From(baseRecipe) {
  return { version: 1, steps: baseRecipe.steps.map((s) => Object.assign({}, s)) };
}

function groupName(groupId) {
  const g = toolGroups.find((x) => x.id === groupId);
  return g ? g.name : groupId;
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const recipeModule = {
  id: 'recipe',
  label: 'Recipe',

  init(container, ctx) {
    const doc = container.ownerDocument || document;
    ensureStyles(doc);
    const t = ctx.t;

    // --- per-instance model -------------------------------------------------
    this._base = resolveBaseRecipe(ctx.state);
    this._versions = [v1From(this._base)]; // index 0 = v1
    this._selected = 0; // which version the parameter table shows
    this._compareOpen = false; // diff panel visibility (Compare toggles)
    this._pending = []; // [{ version, signer, tick }]
    this._signerIdx = 0;
    this._table = null;
    this._dialog = null;
    this._dispatcher = ctx.dispatcher;

    // --- shell --------------------------------------------------------------
    const root = doc.createElement('div');
    root.className = 'recipe-root';

    // head
    const head = doc.createElement('div');
    head.className = 'recipe-head';
    const h1 = doc.createElement('h1');
    this._h1 = h1;
    const en = doc.createElement('span');
    en.className = 'en';
    en.textContent = '/ Recipe';
    h1.appendChild(doc.createTextNode(''));
    h1.appendChild(en);

    const badge = doc.createElement('span');
    badge.className = 'badge badge-info';
    this._badge = badge;

    const actions = doc.createElement('div');
    actions.className = 'actions mobile-actions'; // T33: collapse to notice <768
    this._btnNew = Button({
      i18nKey: 'recipe.action.new_version',
      variant: 'default',
      onClick: () => this._onNewVersion(ctx),
    });
    this._btnCompare = Button({
      i18nKey: 'recipe.action.compare',
      variant: 'default',
      onClick: () => this._onCompare(ctx),
    });
    this._btnSignoff = Button({
      i18nKey: 'recipe.action.sign_off',
      variant: 'primary',
      onClick: () => this._onSignOffOpen(ctx),
    });
    actions.append(this._btnNew, this._btnCompare, this._btnSignoff);
    // T33 <768 desktop-only notice (shown by responsive.css when buttons hide).
    const recipeDtOnly = doc.createElement('span');
    recipeDtOnly.className = 'mobile-desktop-only';
    recipeDtOnly.setAttribute('data-i18n', 'common.desktop_only');
    recipeDtOnly.textContent = ctx.t('common.desktop_only');
    actions.appendChild(recipeDtOnly);
    head.append(h1, badge, actions);

    // --- parameter table panel (top) ---------------------------------------
    const paramPanel = doc.createElement('div');
    paramPanel.className = 'recipe-panel panel';
    paramPanel.dataset.mobile = 'rep'; // T33 <768 representative panel: Recipe table
    paramPanel.dataset.tour = 'recipe.params'; // guided-tour anchor (M2)
    const paramHead = doc.createElement('div');
    paramHead.className = 'panel-head';
    const paramLabel = doc.createElement('span');
    paramLabel.className = 'label';
    this._paramLabel = paramLabel;
    const paramMeta = doc.createElement('span');
    paramMeta.className = 'meta';
    this._paramMeta = paramMeta;
    paramHead.append(paramLabel, paramMeta);
    const paramBody = doc.createElement('div');
    paramBody.className = 'panel-body';
    this._paramBody = paramBody;
    paramPanel.append(paramHead, paramBody);

    // --- version diff panel (bottom) ---------------------------------------
    const diffPanel = doc.createElement('div');
    diffPanel.className = 'recipe-panel panel';
    diffPanel.dataset.mobile = 'hide'; // T33 <768: version diff hidden (rep = table)
    diffPanel.dataset.tour = 'recipe.diff'; // guided-tour anchor (M2)
    const diffHead = doc.createElement('div');
    diffHead.className = 'panel-head';
    const diffLabel = doc.createElement('span');
    diffLabel.className = 'label';
    this._diffLabel = diffLabel;
    const diffMeta = doc.createElement('span');
    diffMeta.className = 'meta';
    this._diffMeta = diffMeta;
    diffHead.append(diffLabel, diffMeta);
    const diffBody = doc.createElement('div');
    diffBody.className = 'panel-body';
    this._diffBody = diffBody;
    diffPanel.append(diffHead, diffBody);

    root.append(head, paramPanel, diffPanel);
    container.appendChild(root);
    this._root = root;

    // subscribe: own emits land back here so the head badge stays coherent if a
    // sibling module ever re-emits recipe.changed (defensive; idempotent).
    ctx.dispatcher.subscribeAll(this.id, {
      'recipe.changed': () => {
        /* state already mutated locally on sign-off; full reconcile next tick */
      },
    });

    // initial full render
    this.update(container, ctx, ctx.router ? 0 : 0);
  },

  // ---- actions -----------------------------------------------------------

  _onNewVersion(ctx) {
    const prev = this._versions[this._versions.length - 1];
    const next = deriveNextVersion(this._base, prev);
    this._versions.push(next);
    this._selected = this._versions.length - 1;
    this._compareOpen = true; // reveal the diff so the delta is visible immediately
    // queue a pending approval for the new head
    const signer = SIGNERS[this._signerIdx % SIGNERS.length];
    this._signerIdx++;
    this._pending.push({ version: next.version, signer });
    Toast({ message: ctx.t('recipe.action.new_version') + ' · v' + next.version, type: 'info' });
    this._render(ctx);
  },

  _onCompare(ctx) {
    if (this._versions.length < 2) {
      // nothing to compare yet — surface the partial-state copy as a gentle toast.
      Toast({ message: ctx.t('states.partial'), type: 'warn' });
      this._compareOpen = true;
      this._render(ctx);
      return;
    }
    this._compareOpen = !this._compareOpen;
    this._render(ctx);
  },

  _onSignOffOpen(ctx) {
    const doc = this._root.ownerDocument || document;
    if (this._pending.length === 0) {
      Toast({ message: ctx.t('states.empty'), type: 'warn' });
      return;
    }
    const body = doc.createElement('div');
    body.className = 'recipe-signoff';

    const list = doc.createElement('div');
    list.className = 'recipe-pending-list';
    this._pending.forEach((p) => {
      const row = doc.createElement('div');
      row.className = 'recipe-pending-row';
      const led = doc.createElement('i');
      led.className = 'led led-warn';
      const txt = doc.createElement('span');
      txt.textContent = this._base.id + ' · v' + p.version;
      const meta = doc.createElement('span');
      meta.className = 'meta';
      meta.textContent = p.signer;
      row.append(led, txt, meta);
      list.appendChild(row);
    });
    body.appendChild(list);

    const head = this._pending[this._pending.length - 1];
    const signerLine = doc.createElement('div');
    signerLine.className = 'recipe-signer';
    signerLine.innerHTML = '';
    const signerStrong = doc.createElement('b');
    signerStrong.textContent = head.signer;
    signerLine.appendChild(doc.createTextNode(ctx.t('recipe.action.sign_off') + ' — '));
    signerLine.appendChild(signerStrong);
    body.appendChild(signerLine);

    const acts = doc.createElement('div');
    acts.className = 'recipe-signoff-actions';
    const confirm = Button({
      i18nKey: 'recipe.action.sign_off',
      variant: 'primary',
      onClick: () => this._onSignOffConfirm(ctx, head),
    });
    acts.appendChild(confirm);
    body.appendChild(acts);

    this._dialog = Dialog({
      titleI18nKey: 'recipe.action.sign_off',
      body,
      onClose: () => {
        this._dialog = null;
      },
    });
  },

  _onSignOffConfirm(ctx, approval) {
    // state-first: clear the approved entry from the pending queue, then emit.
    this._pending = this._pending.filter((p) => p.version !== approval.version);

    // I2: APC (T19) + MES (T15) subscribe to recipe.changed.
    ctx.dispatcher.emit('recipe.changed', {
      recipeId: this._base.id,
      product: this._base.product,
      version: approval.version,
      signer: approval.signer,
      // baseline params the APC R2R animation re-aligns to: head version's steps.
      steps: this._versions[this._versions.length - 1].steps,
    });

    Toast({
      message:
        ctx.t('recipe.action.sign_off') +
        ' ✓ ' +
        this._base.id +
        ' · v' +
        approval.version +
        ' — ' +
        approval.signer,
      type: 'success',
    });

    if (this._dialog) {
      this._dialog.close();
      this._dialog = null;
    }
    this._render(ctx);
  },

  // ---- rendering ---------------------------------------------------------

  update(container, ctx, _tick) {
    this._currentTick = _tick;
    // T24 cross-cutting focus: a recipe.changed chip routes here — open the diff
    // so the signed-off delta is immediately visible. One-shot (router clears
    // ctx.focus after this first update).
    if (ctx && ctx.focus && (ctx.focus.type === 'recipe.changed' || ctx.focus.recipeId)) {
      this._compareOpen = true;
    }
    this._render(ctx);
  },

  _render(ctx) {
    if (!this._root) return;
    const t = ctx.t;
    const doc = this._root.ownerDocument || document;

    // head text (re-read every render — never cache, 6A)
    this._h1.childNodes[0].nodeValue = t('recipe.title').split(' / ')[0] + ' ';
    this._badge.textContent = this._base.id + ' · rev ' + (this._base.revision || 1);

    // sign-off button disabled when no pending approvals
    this._btnSignoff.disabled = this._pending.length === 0;

    this._renderParamTable(ctx, doc);
    this._renderDiff(ctx, doc);
  },

  _renderParamTable(ctx, doc) {
    const t = ctx.t;
    const version = this._versions[this._selected];
    this._paramLabel.textContent = t('recipe.parameter_table') + ' — v' + version.version;
    this._paramMeta.textContent = version.steps.length + ' steps';

    const columns = [
      { key: 'seq', label: 'Step', num: true },
      { key: 'chamber', labelI18nKey: 'recipe.chamber', render: (v, r) => groupName(r.group) + ' · ' + v },
      { key: 'gas', labelI18nKey: 'recipe.gas' },
      { key: 'time', labelI18nKey: 'recipe.time', num: true, render: (v) => v + ' s' },
      { key: 'temp', labelI18nKey: 'recipe.temp', num: true, render: (v) => v + ' °C' },
      { key: 'pressure', labelI18nKey: 'recipe.pressure', num: true, render: (v) => v + ' mTorr' },
    ];

    if (!this._table) {
      this._table = Table({
        columns,
        rows: version.steps,
        ariaLabel: t('recipe.parameter_table'),
      });
      this._paramBody.replaceChildren(this._table.el);
    } else {
      this._table.update({ rows: version.steps });
    }
  },

  _renderDiff(ctx, doc) {
    const t = ctx.t;
    const body = this._diffBody;
    const hasV2 = this._versions.length >= 2;

    if (!this._compareOpen && hasV2) {
      // diff hidden — show a hint label, keep the panel as a quiet placeholder.
      this._diffLabel.textContent = t('recipe.version_diff');
      this._diffMeta.textContent = '';
      body.replaceChildren(this._emptyHint(doc, t('recipe.action.compare')));
      return;
    }

    if (!hasV2) {
      // EMPTY / PARTIAL: only v1 exists.
      this._diffLabel.textContent = t('recipe.version_diff');
      if (this._compareOpen) {
        // PARTIAL — single-side diff (v1 only), faded right column.
        this._diffMeta.textContent = 'v1 · ' + t('states.partial');
        body.replaceChildren(this._buildDiffGrid(doc, this._versions[0], null, t));
      } else {
        // EMPTY — warm copy + deterministic forecast + greyed skeleton.
        this._diffMeta.textContent = '';
        body.replaceChildren(this._buildEmpty(doc, t));
      }
      return;
    }

    // SUCCESS — two-sided diff of the two latest versions.
    const vA = this._versions[this._versions.length - 2];
    const vB = this._versions[this._versions.length - 1];
    const changed = this._countChanges(vA, vB);
    this._diffLabel.textContent = t('recipe.version_diff');
    this._diffMeta.textContent = 'v' + vA.version + ' → v' + vB.version + ' · Δ' + changed;
    body.replaceChildren(this._buildDiffGrid(doc, vA, vB, t));
  },

  _buildEmpty(doc, t) {
    const wrap = doc.createElement('div');
    wrap.className = 'recipe-empty';
    const title = doc.createElement('div');
    title.className = 'recipe-empty-title';
    title.textContent = t('states.recipe.empty');
    const forecast = doc.createElement('div');
    forecast.className = 'recipe-empty-forecast';
    // deterministic tick forecast (states.* vocabulary + concrete tick)
    forecast.textContent = t('recipe.action.new_version') + ' · tick ' + String(FORECAST_TICK).padStart(3, '0');
    const skel = doc.createElement('div');
    skel.className = 'recipe-skeleton';
    for (let i = 0; i < 4; i++) {
      const row = doc.createElement('div');
      row.className = 'recipe-skeleton-row';
      skel.appendChild(row);
    }
    wrap.append(title, forecast, skel);
    return wrap;
  },

  _emptyHint(doc, action) {
    const wrap = doc.createElement('div');
    wrap.className = 'recipe-empty';
    const title = doc.createElement('div');
    title.className = 'recipe-empty-title';
    title.textContent = action;
    wrap.appendChild(title);
    return wrap;
  },

  _countChanges(vA, vB) {
    let n = 0;
    const len = Math.min(vA.steps.length, vB.steps.length);
    for (let i = 0; i < len; i++) {
      const a = vA.steps[i];
      const b = vB.steps[i];
      if (a.temp !== b.temp || a.time !== b.time || a.pressure !== b.pressure) n++;
    }
    return n;
  },

  // side-by-side grid. If vB is null → PARTIAL (single side + faded gridline col).
  _buildDiffGrid(doc, vA, vB, t) {
    const grid = doc.createElement('div');
    grid.className = 'recipe-diff-body';

    const colA = this._buildDiffColumn(doc, vA, vB, 'old', t);
    grid.appendChild(colA);

    if (vB) {
      const colB = this._buildDiffColumn(doc, vB, vA, 'new', t);
      grid.appendChild(colB);
    } else {
      // PARTIAL: faded right column with empty (faded gridline) table.
      const colFaded = this._buildDiffColumn(doc, { version: vA.version + 1, steps: [] }, null, 'new', t);
      colFaded.classList.add('is-faded');
      grid.appendChild(colFaded);
    }
    return grid;
  },

  // side: 'old' highlights changed cells amber, 'new' highlights them green.
  _buildDiffColumn(doc, version, other, side, t) {
    const col = doc.createElement('div');
    col.className = 'recipe-diff-col';

    const colHead = doc.createElement('div');
    colHead.className = 'recipe-diff-colhead';
    const lbl = doc.createElement('span');
    lbl.className = 'label';
    lbl.textContent = 'v' + version.version;
    const pill = doc.createElement('span');
    pill.className = 'diff-pill';
    pill.textContent = side === 'new' ? '+ ' + t('recipe.version_diff') : '−';
    colHead.append(lbl, pill);
    col.appendChild(colHead);

    const table = doc.createElement('table');
    table.className = 'recipe-diff-table';
    const thead = doc.createElement('thead');
    const hr = doc.createElement('tr');
    [
      'Step',
      t('recipe.time'),
      t('recipe.temp'),
      t('recipe.pressure'),
    ].forEach((h) => {
      const th = doc.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = doc.createElement('tbody');
    version.steps.forEach((s, i) => {
      const o = other && other.steps[i];
      const tr = doc.createElement('tr');
      const changed =
        o && (o.temp !== s.temp || o.time !== s.time || o.pressure !== s.pressure);
      if (changed) tr.classList.add('diff-row');

      const cells = [
        { val: s.seq, num: true, field: null },
        { val: s.time, num: true, field: 'time', unit: ' s' },
        { val: s.temp, num: true, field: 'temp', unit: ' °C' },
        { val: s.pressure, num: true, field: 'pressure', unit: ' mTorr' },
      ];
      cells.forEach((c) => {
        const td = doc.createElement('td');
        if (c.num) td.className = 'num';
        td.textContent = c.val + (c.unit || '');
        if (c.field && o && o[c.field] !== s[c.field]) {
          td.classList.add(side === 'new' ? 'diff-new' : 'diff-old');
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    col.appendChild(table);
    return col;
  },

  destroy() {
    if (this._dialog) {
      try {
        this._dialog.close();
      } catch (_) { /* defensive */ }
      this._dialog = null;
    }
    if (this._table) {
      try {
        this._table.destroy();
      } catch (_) { /* defensive */ }
      this._table = null;
    }
    if (this._dispatcher) {
      this._dispatcher.unsubscribeAll(this.id);
      this._dispatcher = null;
    }
    this._root = null;
  },
};

export default recipeModule;
