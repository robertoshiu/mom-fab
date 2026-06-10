// engine/factory.js
// Deterministic object factory: products, lots, equipment, recipes, tool groups.
// Every field is derived from fnv1a(id)-seeded mulberry32 streams, so the same
// input always yields a deep-equal output. All domain constants come from
// scenarios/mom-fab.js — nothing is hardcoded here.

import { mulberry32, fnv1a } from './prng.js';
import {
  products,
  toolGroups,
  defectTypes,
  WAFERS_PER_LOT,
  LOT_COUNT,
  TOOL_COUNT,
  RECIPE_COUNT,
} from '../scenarios/mom-fab.js';

// --- helpers ---------------------------------------------------------------

function streamFor(id, salt) {
  return mulberry32(fnv1a(salt + ':' + id) >>> 0);
}

function intIn(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function resolveProduct(product) {
  if (product && typeof product === 'object' && product.id) {
    const found = products.find((p) => p.id === product.id);
    return found || product;
  }
  const found = products.find((p) => p.id === product);
  return found || products[0];
}

// --- products --------------------------------------------------------------

export function createProduct(id) {
  const base = products.find((p) => p.id === id) || products[0];
  const rng = streamFor(base.id, 'product');
  return {
    id: base.id,
    name: base.name,
    recipeCount: base.recipeCount,
    priority: intIn(rng, 1, 5),
  };
}

// --- tool groups -----------------------------------------------------------

export function createToolGroup(id) {
  const base = toolGroups.find((g) => g.id === id) || toolGroups[0];
  const rng = streamFor(base.id, 'toolGroup');
  const memberCount = intIn(rng, 8, 16);
  const members = [];
  for (let i = 0; i < memberCount; i++) {
    members.push(base.prefix + '-' + String(i + 1).padStart(2, '0'));
  }
  return {
    id: base.id,
    name: base.name,
    prefix: base.prefix,
    cycleTime: { min: base.cycleTime.min, max: base.cycleTime.max },
    members,
  };
}

// --- equipment -------------------------------------------------------------

export function createEquipment(id) {
  const rng = streamFor(id, 'equipment');
  const group = pick(rng, toolGroups);
  const cycleTime = intIn(rng, group.cycleTime.min, group.cycleTime.max);
  return {
    id,
    group: group.id,
    groupName: group.name,
    cycleTime,
    chambers: intIn(rng, 1, 4),
    state: pick(rng, ['idle', 'productive', 'standby', 'down']),
  };
}

// --- recipes ---------------------------------------------------------------

const GASES = ['Ar', 'O2', 'N2', 'CF4', 'Cl2', 'SF6', 'H2', 'NH3'];

export function createRecipe(id, product) {
  const base = resolveProduct(product);
  const rng = streamFor(id, 'recipe');
  const stepCount = base.recipeCount;
  const steps = [];
  for (let i = 0; i < stepCount; i++) {
    const sRng = streamFor(id + '#' + i, 'recipeStep');
    const group = toolGroups[intIn(sRng, 0, toolGroups.length - 1)];
    steps.push({
      stepId: id + '-S' + String(i + 1).padStart(2, '0'),
      seq: i + 1,
      group: group.id,
      chamber: 'CH' + intIn(sRng, 1, 4),
      gas: GASES[intIn(sRng, 0, GASES.length - 1)],
      temp: intIn(sRng, 80, 1100),
      time: intIn(sRng, 20, 200),
      pressure: intIn(sRng, 5, 760),
    });
  }
  return {
    id,
    product: base.id,
    revision: intIn(rng, 1, 9),
    steps,
  };
}

// --- lots ------------------------------------------------------------------

export function createLot(id, product) {
  const base = resolveProduct(product);
  const rng = streamFor(id, 'lot');
  const stepCount = base.recipeCount;
  const route = [];
  for (let i = 0; i < stepCount; i++) {
    route.push(base.id + '-S' + String(i + 1).padStart(2, '0'));
  }
  return {
    id,
    product: base.id,
    wafers: WAFERS_PER_LOT,
    priority: intIn(rng, 1, 5),
    route,
    startTick: intIn(rng, 0, 179),
  };
}

// --- pregeneration ---------------------------------------------------------

export function pregenerate() {
  const lots = new Map();
  for (let i = 0; i < LOT_COUNT; i++) {
    const id = 'L-' + String(i + 1).padStart(3, '0');
    const prodRng = streamFor(id, 'lotProduct');
    const product = products[intIn(prodRng, 0, products.length - 1)];
    lots.set(id, createLot(id, product));
  }

  const equipment = new Map();
  for (let i = 0; i < TOOL_COUNT; i++) {
    const id = 'EQP-' + String(i + 1).padStart(3, '0');
    equipment.set(id, createEquipment(id));
  }

  const recipes = new Map();
  for (let i = 0; i < RECIPE_COUNT; i++) {
    const id = 'RCP-' + String(i + 1).padStart(3, '0');
    const prodRng = streamFor(id, 'recipeProduct');
    const product = products[intIn(prodRng, 0, products.length - 1)];
    recipes.set(id, createRecipe(id, product));
  }

  const groups = new Map();
  for (const g of toolGroups) {
    groups.set(g.id, createToolGroup(g.id));
  }

  return { lots, equipment, recipes, groups };
}
