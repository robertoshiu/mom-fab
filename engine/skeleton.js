// engine/skeleton.js
// Deterministic 180-tick lot lifecycle skeleton generator.
//
// generateSkeleton(lots, equipment, recipes) returns a 180-entry array
// [{ tick, events: LotEvent[] }]. Each lot contributes a deterministic
// sequence of lifecycle events (lot.start -> step.transition* ->
// material.in_transit -> lot.complete), with all timing derived from
// fnv1a(lotId) -> mulberry32. Identical inputs always yield a JSON-identical
// skeleton (no Math.random / Date.now / live state).
//
// LotEvent shape (C2): { tick, type, lotId, suppressible: true, payload }.
// suppressible + lotId let engine/event-gate.js suppress every skeleton event
// for a lot the user has Hold/Scrap/Completed. NO SPC points, defects, or
// alarms are produced here — those are per-tick jitter owned by other tasks.

import { mulberry32, fnv1a } from './prng.js';

const EPOCH_LENGTH = 180;

function intIn(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Normalize a lots/equipment/recipes argument that may be a Map or an Array
// into an Array of values, preserving deterministic order.
function toArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection.slice();
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return Object.keys(collection).map((k) => collection[k]);
}

// Equipment whose group matches the recipe step's tool group, so a lot at a
// litho step lands on a litho tool. Falls back to all equipment if no match.
function equipmentForGroup(equipmentList, group) {
  const matches = equipmentList.filter((e) => e.group === group);
  return matches.length ? matches : equipmentList;
}

// Build the deterministic event sequence for a single lot. Returns a flat
// Array<LotEvent>. The lot starts at lot.startTick and finishes within the
// epoch; 2-5 step.transition events are spread between start and complete.
function buildLotEvents(lot, equipmentList, recipe) {
  const rng = mulberry32(fnv1a(lot.id) >>> 0);
  const events = [];

  // 2-5 step transitions per lot (plan heuristic).
  const route = Array.isArray(lot.route) ? lot.route : [];
  const recipeSteps = recipe && Array.isArray(recipe.steps) ? recipe.steps : [];
  const stepCount = Math.max(2, Math.min(5, intIn(rng, 2, 5)));

  // A fab runs continuously: there is WIP already in-line at epoch start
  // (lots starting at tick 0) and lots crossing the finish line at epoch end
  // (completing at tick 179). We use the lot-hash phase to deterministically
  // populate both epoch boundaries while still spreading the bulk across the
  // 180-tick window. `phase` in [0,1) buckets each lot.
  const phase = fnv1a('skeleton-phase:' + lot.id) / 0xffffffff;

  // ~10% of lots are already in-line at epoch start (startTick 0).
  const startsAtBoundary = phase < 0.1;
  const startTick = startsAtBoundary
    ? 0
    : Math.min(intIn(rng, 0, EPOCH_LENGTH - 2), EPOCH_LENGTH - 2);

  // ~10% of lots cross the finish line at epoch end (completeTick 179).
  const completesAtBoundary = phase >= 0.9;
  const span = intIn(rng, stepCount + 1, Math.max(stepCount + 2, EPOCH_LENGTH - 1 - startTick));
  const completeTick = completesAtBoundary
    ? EPOCH_LENGTH - 1
    : Math.min(startTick + span, EPOCH_LENGTH - 1);

  // Resolve the first equipment for the start event from the first route step.
  function stepDescriptor(stepIndex) {
    const stepId = route.length
      ? route[stepIndex % route.length]
      : lot.product + '-S' + String((stepIndex % 14) + 1).padStart(2, '0');
    const rStep = recipeSteps.length ? recipeSteps[stepIndex % recipeSteps.length] : null;
    const group = rStep ? rStep.group : null;
    const eq = group
      ? pick(rng, equipmentForGroup(equipmentList, group))
      : (equipmentList.length ? pick(rng, equipmentList) : null);
    return {
      stepId,
      equipment: eq ? eq.id : null,
      group: eq ? eq.group : group,
    };
  }

  // lot.start
  const first = stepDescriptor(0);
  events.push({
    tick: startTick,
    type: 'lot.start',
    lotId: lot.id,
    suppressible: true,
    payload: {
      lotId: lot.id,
      product: lot.product,
      wafers: lot.wafers,
      priority: lot.priority,
      step: first.stepId,
      equipment: first.equipment,
      qTime: 0,
    },
  });

  // step.transition events spread evenly across (startTick, completeTick).
  const innerSpan = completeTick - startTick;
  let prevTick = startTick;
  let prevStep = first;
  for (let s = 1; s <= stepCount; s++) {
    const frac = s / (stepCount + 1);
    let tTick = startTick + Math.round(frac * innerSpan);
    if (tTick <= prevTick) tTick = prevTick + 1;
    if (tTick >= completeTick) tTick = completeTick - 1;
    if (tTick <= prevTick) continue; // no room left, skip extra steps
    const desc = stepDescriptor(s);
    const qTime = intIn(rng, 0, 45);
    events.push({
      tick: tTick,
      type: 'step.transition',
      lotId: lot.id,
      suppressible: true,
      payload: {
        lotId: lot.id,
        product: lot.product,
        fromStep: prevStep.stepId,
        toStep: desc.stepId,
        equipment: desc.equipment,
        qTime,
      },
    });
    prevTick = tTick;
    prevStep = desc;
  }

  // material.in_transit — a single wafer-move event mid-life (~100 total).
  let moveTick = startTick + Math.round(innerSpan * 0.5);
  if (moveTick <= startTick) moveTick = startTick + 1;
  if (moveTick >= completeTick) moveTick = completeTick - 1;
  if (moveTick > startTick && moveTick < completeTick) {
    events.push({
      tick: moveTick,
      type: 'material.in_transit',
      lotId: lot.id,
      suppressible: true,
      payload: {
        lotId: lot.id,
        product: lot.product,
        wafers: lot.wafers,
        toEquipment: prevStep.equipment,
        step: prevStep.stepId,
      },
    });
  }

  // lot.complete
  events.push({
    tick: completeTick,
    type: 'lot.complete',
    lotId: lot.id,
    suppressible: true,
    payload: {
      lotId: lot.id,
      product: lot.product,
      wafers: lot.wafers,
      step: prevStep.stepId,
      equipment: prevStep.equipment,
      qTime: 0,
    },
  });

  return events;
}

// generateSkeleton(lots, equipment, recipes)
// lots/equipment/recipes accept Map (factory.pregenerate output) or Array.
export function generateSkeleton(lots, equipment, recipes) {
  const lotList = toArray(lots);
  const equipmentList = toArray(equipment);
  const recipeList = toArray(recipes);

  // Index recipes by product for step-group resolution. A lot uses the first
  // recipe matching its product, falling back to any recipe.
  const recipeByProduct = new Map();
  for (const r of recipeList) {
    if (r && r.product && !recipeByProduct.has(r.product)) {
      recipeByProduct.set(r.product, r);
    }
  }

  const skeleton = [];
  for (let t = 0; t < EPOCH_LENGTH; t++) {
    skeleton.push({ tick: t, events: [] });
  }

  for (const lot of lotList) {
    const recipe = recipeByProduct.get(lot.product) || recipeList[0] || null;
    const events = buildLotEvents(lot, equipmentList, recipe);
    for (const ev of events) {
      if (ev.tick >= 0 && ev.tick < EPOCH_LENGTH) {
        skeleton[ev.tick].events.push(ev);
      }
    }
  }

  return skeleton;
}

// getLotAtTick(skeleton, lotId, tick)
// Replays a lot's skeleton events up to and including `tick`, returning its
// current lifecycle state. Returns null if the lot never starts by `tick`.
export function getLotAtTick(skeleton, lotId, tick) {
  let currentStep = null;
  let currentEquipment = null;
  let qTime = 0;
  let lastEventTick = null;
  let started = false;
  let completed = false;

  for (let t = 0; t <= tick && t < skeleton.length; t++) {
    const slot = skeleton[t];
    if (!slot) continue;
    for (const ev of slot.events) {
      if (ev.lotId !== lotId) continue;
      const p = ev.payload || {};
      if (ev.type === 'lot.start') {
        started = true;
        currentStep = p.step || null;
        currentEquipment = p.equipment || null;
        qTime = p.qTime || 0;
      } else if (ev.type === 'step.transition') {
        currentStep = p.toStep || currentStep;
        currentEquipment = p.equipment || currentEquipment;
        qTime = p.qTime || 0;
      } else if (ev.type === 'material.in_transit') {
        currentEquipment = p.toEquipment || currentEquipment;
      } else if (ev.type === 'lot.complete') {
        completed = true;
        currentStep = p.step || currentStep;
        currentEquipment = p.equipment || currentEquipment;
        qTime = 0;
      }
      lastEventTick = ev.tick;
    }
  }

  if (!started) return null;

  // qTime accrues since the last event while the lot waits at its step.
  const waited = lastEventTick == null ? 0 : Math.max(0, tick - lastEventTick);

  return {
    lotId,
    currentStep,
    currentEquipment,
    qTime: completed ? 0 : qTime + waited,
    status: completed ? 'complete' : 'running',
  };
}
