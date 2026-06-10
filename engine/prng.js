export const SEED_BASE = 0x5FAB300;

export function mulberry32(a) {
  return function() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    var t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function deriveSeed(namespace, id, epochSeed = 0) {
  return (fnv1a(namespace + ':' + id) ^ SEED_BASE ^ (epochSeed >>> 0)) >>> 0;
}

export function deriveTickSeed(domain, tick, epochSeed = 0) {
  const seed = (fnv1a(domain + ':' + tick) ^ SEED_BASE ^ (epochSeed >>> 0)) >>> 0;
  return mulberry32(seed);
}

const LOT_TYPES = ['production', 'engineering', 'qualification', 'hot'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export function hashRandomLot(lotId, epochSeed = 0) {
  const h = (fnv1a('lot:' + lotId) ^ (epochSeed >>> 0)) >>> 0;
  return {
    type: LOT_TYPES[h % LOT_TYPES.length],
    priority: PRIORITIES[(h >>> 8) % PRIORITIES.length],
    cycleTime: 60 + ((h >>> 16) % 240)
  };
}

export function hashRandomEquipment(equipmentId, epochSeed = 0) {
  const h = (fnv1a('equipment:' + equipmentId) ^ (epochSeed >>> 0)) >>> 0;
  return {
    cycleTime: 30 + (h % 300),
    priority: PRIORITIES[(h >>> 8) % PRIORITIES.length]
  };
}

export function hashRandomRecipe(recipeId, epochSeed = 0) {
  const h = (fnv1a('recipe:' + recipeId) ^ (epochSeed >>> 0)) >>> 0;
  return {
    stepTime: 20 + (h % 180),
    revision: 1 + ((h >>> 16) % 9)
  };
}
