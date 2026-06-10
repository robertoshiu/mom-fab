// scenarios/mom-fab.js
// MOM FAB scenario manifest — PURE DATA, ZERO-DEPENDENCY ES module.
// Single-layer JS parameterization: no plugin system, no DSL, no multi-scenario loader.
// All engine/module domain constants are imported from this file; never hardcoded elsewhere.

// ---------------------------------------------------------------------------
// (a) Domain constants
// ---------------------------------------------------------------------------

export const WAFERS_PER_LOT = 25;
export const LOT_COUNT = 100;
export const TOOL_COUNT = 100;
export const RECIPE_COUNT = 50;

export const products = Object.freeze([
  Object.freeze({ id: 'LOGIC-A', name: 'Logic A (7nm SoC)', recipeCount: 14, priority: 'high' }),
  Object.freeze({ id: 'LOGIC-B', name: 'Logic B (5nm SoC)', recipeCount: 16, priority: 'high' }),
  Object.freeze({ id: 'MEM-DDR', name: 'Memory DDR5', recipeCount: 9, priority: 'normal' }),
  Object.freeze({ id: 'MEM-NAND', name: '3D NAND', recipeCount: 11, priority: 'normal' }),
  Object.freeze({ id: 'RF-GaN', name: 'RF GaN Power', recipeCount: 7, priority: 'low' }),
]);

export const toolGroups = Object.freeze([
  Object.freeze({ id: 'PHOTO', name: 'Photolithography', prefix: 'LITHO', cycleTime: Object.freeze({ min: 45, max: 90 }) }),
  Object.freeze({ id: 'ETCH', name: 'Etch', prefix: 'ETCH', cycleTime: Object.freeze({ min: 30, max: 75 }) }),
  Object.freeze({ id: 'CVD', name: 'CVD', prefix: 'CVD', cycleTime: Object.freeze({ min: 40, max: 110 }) }),
  Object.freeze({ id: 'PVD', name: 'PVD', prefix: 'PVD', cycleTime: Object.freeze({ min: 35, max: 95 }) }),
  Object.freeze({ id: 'CMP', name: 'CMP', prefix: 'CMP', cycleTime: Object.freeze({ min: 20, max: 50 }) }),
  Object.freeze({ id: 'IMPLANT', name: 'Implant', prefix: 'IMP', cycleTime: Object.freeze({ min: 25, max: 60 }) }),
  Object.freeze({ id: 'INSPECT', name: 'Inspection', prefix: 'INSP', cycleTime: Object.freeze({ min: 10, max: 30 }) }),
  Object.freeze({ id: 'WETCLEAN', name: 'WetClean', prefix: 'WET', cycleTime: Object.freeze({ min: 15, max: 40 }) }),
]);

export const defectTypes = Object.freeze([
  Object.freeze({ id: 'particle', name: 'Particle', severity: 'minor' }),
  Object.freeze({ id: 'scratch', name: 'Scratch', severity: 'major' }),
  Object.freeze({ id: 'pattern-bridge', name: 'Pattern Bridge', severity: 'critical' }),
  Object.freeze({ id: 'pressure-excursion', name: 'Pressure Excursion', severity: 'major' }),
  Object.freeze({ id: 'overlay-shift', name: 'Overlay Shift', severity: 'major' }),
  Object.freeze({ id: 'contamination', name: 'Contamination', severity: 'critical' }),
]);

// KPI thresholds (per I3: yield rolling alert at 88%).
export const kpiThresholds = Object.freeze({
  yield: Object.freeze({ warn: 90, danger: 80, alert: 88 }),
  throughput: Object.freeze({ warn: 850, danger: 700 }),
  oee: Object.freeze({ warn: 80, danger: 65 }),
  utilization: Object.freeze({ warn: 75, danger: 60 }),
});

// ---------------------------------------------------------------------------
// (b) Hero story timeline — TICK units (not wall-clock). Defect injection bound
//     to a specific tick to preserve PRNG determinism.
// ---------------------------------------------------------------------------

export const heroTimeline = Object.freeze({
  // Lot the narrative follows; resolved deterministically by the consuming module.
  lotId: 'L-042',
  product: 'LOGIC-A',
  // Autoplay gate: first load auto-plays once when scheduler.currentTick === 3.
  autoplayGateTick: 3,
  // once-per-load: epoch loop back to tick 0 does NOT replay; manual replay via topbar only.
  replayPolicy: 'once-per-load',
  // Defect injection bound to a specific tick (deterministic, not imperative live injection).
  defectInjectionTick: 10,
  defectType: 'pressure-excursion',
  steps: Object.freeze([
    Object.freeze({ tick: 0, module: 'mes', highlight: 'lot-row', note: 'L-042 started at Photolithography' }),
    Object.freeze({ tick: 10, module: 'spc', highlight: 'xbar-point', note: 'SPC violation: chamber pressure' }),
    Object.freeze({ tick: 18, module: 'apc', highlight: 'r2r-adjust', note: 'APC adjustment: pressure -2.3%' }),
    Object.freeze({ tick: 25, module: 'yield', highlight: 'pareto-bar', note: 'Pressure excursion defect density up' }),
    Object.freeze({ tick: 30, module: 'overview', highlight: 'sparkline', note: 'L-042 marked Recovered' }),
  ]),
});

// ---------------------------------------------------------------------------
// (c) Event type -> target module routing table.
//     Covers every dispatcher event type.
// ---------------------------------------------------------------------------

export const eventRouting = Object.freeze({
  'lot.start': 'mes',
  'lot.complete': 'mes',
  'step.transition': 'mes',
  'equipment.alarm': 'aps',
  'equipment.idle': 'aps',
  'spc.violation': 'spc',
  'apc.adjustment': 'apc',
  'defect.detected': 'yield',
  'recipe.changed': 'recipe',
  'yield.alert': 'yield',
  'po.received': 'erp',
  'material.in_transit': 'scm',
});
