// scenarios/tours.js
// Guided-tour content manifest — PURE DATA, ZERO-DEPENDENCY ES module.
// Same discipline as scenarios/mom-fab.js: a single declarative array the tour
// engine (engine/tour-engine.js) sequences. NO imports, NO DOM, NO logic.
//
// Contract with the tour engine (M1 — must match exactly):
//   tours = [ { id, estimate /* seconds */, steps: [ {
//       id,                  // step id (i18n key segment)
//       module,              // null = shell-level step, else the module id to mount
//       anchor,              // data-tour value, or null = centred card (no spotlight)
//       fallbackAnchor,      // optional secondary data-tour if anchor is missing/hidden
//       placement,           // optional 'left'|'right'|'top'|'bottom' callout side hint
//       pad,                 // optional spotlight mask padding override (px)
//       focus,               // optional router focus payload (T24 cross-cut highlight)
//       desktopOnly,         // optional bool — step's anchor is hidden <768 (engine skips
//                            //   or shows the desktop-only card)
//       final,               // optional bool — centred summary card (no anchor, no hole)
//   } ] } ]
//
// i18n keys per step:
//   tour.<tourId>.title                 — tour name (Guide Hub list + topbar)
//   tour.<tourId>.<stepId>.title        — step engraved label (≤4 words)
//   tour.<tourId>.<stepId>.body         — step body (1-2 sentences, function→meaning)
// Shared UI strings live under tour.ui.* and guide.* (see i18n JSONs).
//
// Anchor values map 1:1 to data-tour attributes added at element-creation points
// in shell/ and modules/ (M2). desktopOnly is set wherever the anchored panel is
// dataset.mobile === 'hide' (collapsed below 768 per the T33 viewport matrix).
//
// Step-count limits (DS-10): module tours 4-6 steps; onboarding ≤7; grand-tour ≤18.

export const tours = Object.freeze([
  // -------------------------------------------------------------------------
  // 1. onboarding — first-contact orientation of the shell (≤7 steps).
  //    The final card's "continue: grand tour" action is surfaced by the engine.
  // -------------------------------------------------------------------------
  Object.freeze({
    id: 'onboarding',
    estimate: 30,
    steps: Object.freeze([
      Object.freeze({ id: 'nav', module: null, anchor: 'shell.nav', placement: 'right' }),
      Object.freeze({ id: 'kpi', module: null, anchor: 'shell.kpi-strip', placement: 'bottom' }),
      Object.freeze({ id: 'river', module: null, anchor: 'shell.river', placement: 'bottom', pad: 16 }),
      Object.freeze({ id: 'controls', module: null, anchor: 'shell.theme', fallbackAnchor: 'shell.locale', placement: 'right' }),
      Object.freeze({ id: 'demo', module: null, anchor: 'shell.demo', placement: 'right' }),
      Object.freeze({ id: 'finish', module: null, anchor: null, final: true }),
    ]),
  }),

  // -------------------------------------------------------------------------
  // 2. grand-tour — 一片晶圓的旅程: order → yield, following production flow.
  //    1-2 steps per module along ERP→APS→MES→Recipe→WIP→SPC→APC→Yield→SCM.
  //    (≤18 steps)
  // -------------------------------------------------------------------------
  Object.freeze({
    id: 'grand-tour',
    estimate: 90,
    steps: Object.freeze([
      Object.freeze({ id: 'erp-order', module: 'erp', anchor: 'erp.kanban', placement: 'left' }),
      Object.freeze({ id: 'erp-bom', module: 'erp', anchor: 'erp.bom', fallbackAnchor: 'erp.kanban', placement: 'right', desktopOnly: true }),
      Object.freeze({ id: 'aps-dispatch', module: 'aps', anchor: 'aps.dispatch', fallbackAnchor: 'aps.load', placement: 'top', desktopOnly: true }),
      Object.freeze({ id: 'aps-load', module: 'aps', anchor: 'aps.load', placement: 'top' }),
      Object.freeze({ id: 'mes-lots', module: 'mes', anchor: 'mes.lot-table', placement: 'bottom', focus: Object.freeze({ lotId: 'L-042' }) }),
      Object.freeze({ id: 'mes-gantt', module: 'mes', anchor: 'mes.gantt', fallbackAnchor: 'mes.lot-table', placement: 'top', desktopOnly: true }),
      Object.freeze({ id: 'recipe-versions', module: 'recipe', anchor: 'recipe.params', placement: 'bottom' }),
      Object.freeze({ id: 'wip-flow', module: 'wip', anchor: 'wip.queue', fallbackAnchor: 'wip.flow', placement: 'left' }),
      Object.freeze({ id: 'spc-chart', module: 'spc', anchor: 'spc.xbar', placement: 'right', focus: Object.freeze({ type: 'spc.violation' }) }),
      Object.freeze({ id: 'spc-rules', module: 'spc', anchor: 'spc.rules', fallbackAnchor: 'spc.xbar', placement: 'left', desktopOnly: true }),
      Object.freeze({ id: 'apc-r2r', module: 'apc', anchor: 'apc.fdc', fallbackAnchor: 'apc.r2r', placement: 'top' }),
      Object.freeze({ id: 'yield-pareto', module: 'yield', anchor: 'yield.pareto', placement: 'bottom' }),
      Object.freeze({ id: 'yield-wafer', module: 'yield', anchor: 'yield.wafer', fallbackAnchor: 'yield.pareto', placement: 'left', desktopOnly: true }),
      Object.freeze({ id: 'scm-suppliers', module: 'scm', anchor: 'scm.scorecard', placement: 'bottom' }),
      Object.freeze({ id: 'finish', module: null, anchor: null, final: true }),
    ]),
  }),

  // -------------------------------------------------------------------------
  // 3-11. Per-module workflow tours (4-6 steps each, ending in a final card).
  // -------------------------------------------------------------------------
  Object.freeze({
    id: 'tour-mes',
    estimate: 35,
    steps: Object.freeze([
      Object.freeze({ id: 'table', module: 'mes', anchor: 'mes.lot-table', placement: 'bottom' }),
      Object.freeze({ id: 'select', module: 'mes', anchor: 'mes.lot-table', placement: 'bottom', focus: Object.freeze({ lotId: 'L-042' }) }),
      Object.freeze({ id: 'gantt', module: 'mes', anchor: 'mes.gantt', fallbackAnchor: 'mes.lot-table', placement: 'top', desktopOnly: true }),
      Object.freeze({ id: 'actions', module: 'mes', anchor: 'mes.lot-table', placement: 'bottom', desktopOnly: true }),
      Object.freeze({ id: 'finish', module: 'mes', anchor: null, final: true }),
    ]),
  }),

  Object.freeze({
    id: 'tour-aps',
    estimate: 30,
    steps: Object.freeze([
      Object.freeze({ id: 'dispatch', module: 'aps', anchor: 'aps.dispatch', fallbackAnchor: 'aps.load', placement: 'top', desktopOnly: true }),
      Object.freeze({ id: 'load', module: 'aps', anchor: 'aps.load', placement: 'top' }),
      Object.freeze({ id: 'redispatch', module: 'aps', anchor: 'aps.dispatch', fallbackAnchor: 'aps.load', placement: 'top', desktopOnly: true }),
      Object.freeze({ id: 'finish', module: 'aps', anchor: null, final: true }),
    ]),
  }),

  Object.freeze({
    id: 'tour-erp',
    estimate: 30,
    steps: Object.freeze([
      Object.freeze({ id: 'bom', module: 'erp', anchor: 'erp.bom', fallbackAnchor: 'erp.kanban', placement: 'right', desktopOnly: true }),
      Object.freeze({ id: 'kanban', module: 'erp', anchor: 'erp.kanban', placement: 'left' }),
      Object.freeze({ id: 'create', module: 'erp', anchor: 'erp.kanban', placement: 'left' }),
      Object.freeze({ id: 'finish', module: 'erp', anchor: null, final: true }),
    ]),
  }),

  Object.freeze({
    id: 'tour-spc',
    estimate: 40,
    steps: Object.freeze([
      Object.freeze({ id: 'chart', module: 'spc', anchor: 'spc.xbar', placement: 'right' }),
      Object.freeze({ id: 'rules', module: 'spc', anchor: 'spc.rules', fallbackAnchor: 'spc.xbar', placement: 'left', desktopOnly: true }),
      Object.freeze({ id: 'rchart', module: 'spc', anchor: 'spc.r', fallbackAnchor: 'spc.xbar', placement: 'right', desktopOnly: true }),
      Object.freeze({ id: 'vlog', module: 'spc', anchor: 'spc.vlog', fallbackAnchor: 'spc.xbar', placement: 'top', desktopOnly: true, focus: Object.freeze({ type: 'spc.violation' }) }),
      Object.freeze({ id: 'finish', module: 'spc', anchor: null, final: true }),
    ]),
  }),

  Object.freeze({
    id: 'tour-apc',
    estimate: 35,
    steps: Object.freeze([
      Object.freeze({ id: 'r2r', module: 'apc', anchor: 'apc.r2r', fallbackAnchor: 'apc.fdc', placement: 'bottom', desktopOnly: true }),
      Object.freeze({ id: 'controller', module: 'apc', anchor: 'apc.r2r', fallbackAnchor: 'apc.fdc', placement: 'bottom', desktopOnly: true }),
      Object.freeze({ id: 'fdc', module: 'apc', anchor: 'apc.fdc', placement: 'top' }),
      Object.freeze({ id: 'finish', module: 'apc', anchor: null, final: true }),
    ]),
  }),

  Object.freeze({
    id: 'tour-wip',
    estimate: 35,
    steps: Object.freeze([
      Object.freeze({ id: 'gantt', module: 'wip', anchor: 'wip.gantt', fallbackAnchor: 'wip.queue', placement: 'bottom', desktopOnly: true }),
      Object.freeze({ id: 'flow', module: 'wip', anchor: 'wip.flow', fallbackAnchor: 'wip.queue', placement: 'top', desktopOnly: true }),
      Object.freeze({ id: 'queue', module: 'wip', anchor: 'wip.queue', placement: 'left' }),
      Object.freeze({ id: 'finish', module: 'wip', anchor: null, final: true }),
    ]),
  }),

  Object.freeze({
    id: 'tour-scm',
    estimate: 30,
    steps: Object.freeze([
      Object.freeze({ id: 'scorecard', module: 'scm', anchor: 'scm.scorecard', placement: 'bottom' }),
      Object.freeze({ id: 'transit', module: 'scm', anchor: 'scm.transit', fallbackAnchor: 'scm.scorecard', placement: 'top', desktopOnly: true }),
      Object.freeze({ id: 'receive', module: 'scm', anchor: 'scm.transit', fallbackAnchor: 'scm.scorecard', placement: 'top', desktopOnly: true }),
      Object.freeze({ id: 'finish', module: 'scm', anchor: null, final: true }),
    ]),
  }),

  Object.freeze({
    id: 'tour-recipe',
    estimate: 35,
    steps: Object.freeze([
      Object.freeze({ id: 'params', module: 'recipe', anchor: 'recipe.params', placement: 'bottom' }),
      Object.freeze({ id: 'newversion', module: 'recipe', anchor: 'recipe.params', placement: 'bottom' }),
      Object.freeze({ id: 'diff', module: 'recipe', anchor: 'recipe.diff', fallbackAnchor: 'recipe.params', placement: 'top', desktopOnly: true }),
      Object.freeze({ id: 'signoff', module: 'recipe', anchor: 'recipe.params', placement: 'bottom' }),
      Object.freeze({ id: 'finish', module: 'recipe', anchor: null, final: true }),
    ]),
  }),

  Object.freeze({
    id: 'tour-yield',
    estimate: 35,
    steps: Object.freeze([
      Object.freeze({ id: 'pareto', module: 'yield', anchor: 'yield.pareto', placement: 'bottom' }),
      Object.freeze({ id: 'wafer', module: 'yield', anchor: 'yield.wafer', fallbackAnchor: 'yield.pareto', placement: 'right', desktopOnly: true }),
      Object.freeze({ id: 'trend', module: 'yield', anchor: 'yield.trend', placement: 'left' }),
      Object.freeze({ id: 'drilldown', module: 'yield', anchor: 'yield.pareto', placement: 'bottom' }),
      Object.freeze({ id: 'finish', module: 'yield', anchor: null, final: true }),
    ]),
  }),
]);

export const tourIds = tours.map((tour) => tour.id);

export default tours;
