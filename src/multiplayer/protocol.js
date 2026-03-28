import { Island } from '../entities/Island';

// Serialize a ship to a minimal object for network transmission
export function serializeShip(ship) {
  return {
    id: ship.id,
    x: Math.round(ship.x * 10) / 10,
    y: Math.round(ship.y * 10) / 10,
    angle: Math.round(ship.angle * 1000) / 1000,
    speed: Math.round(ship.speed * 1000) / 1000,
    health: ship.health,
    isSinking: ship.isSinking,
    sinkProgress: Math.round(ship.sinkProgress * 1000) / 1000,
    typeId: ship.typeId,
    cooldownL: ship.cooldownL,
    cooldownR: ship.cooldownR,
    isPlayer: ship.isPlayer,
  };
}

// Apply network state onto an existing ship instance
export function applyShipState(ship, data) {
  ship.x = data.x;
  ship.y = data.y;
  ship.angle = data.angle;
  ship.speed = data.speed;
  ship.health = data.health;
  ship.isSinking = data.isSinking;
  ship.sinkProgress = data.sinkProgress;
  ship.cooldownL = data.cooldownL;
  ship.cooldownR = data.cooldownR;
}

export function serializeCannonball(cb) {
  return {
    id: cb.id,
    x: Math.round(cb.x * 10) / 10,
    y: Math.round(cb.y * 10) / 10,
    z: Math.round(cb.z * 100) / 100,
    vx: Math.round(cb.vx * 1000) / 1000,
    vy: Math.round(cb.vy * 1000) / 1000,
    vz: Math.round(cb.vz * 1000) / 1000,
    ownerId: cb.ownerId,
    active: cb.active,
  };
}

// Serialize full game state (host -> guests)
export function serializeGameState(entities, score, mode) {
  const allShips = [];
  if (entities.player) allShips.push(serializeShip(entities.player));
  for (const s of entities.playerShips || []) allShips.push(serializeShip(s));
  for (const e of entities.enemies) allShips.push(serializeShip(e));

  return {
    type: 'state',
    ships: allShips,
    cannonballs: entities.cannonballs.filter((c) => c.active).map(serializeCannonball),
    wind: Math.round(entities.wind.angle * 1000) / 1000,
    score,
    mode,
  };
}

// Seeded PRNG (mulberry32) for deterministic island generation
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate islands deterministically from a seed
export function generateSeededIslands(seed, worldWidth, worldHeight) {
  const rng = mulberry32(seed);
  const islands = [];
  for (let i = 0; i < 8; i++) {
    let x, y, tries = 0;
    do {
      x = 600 + rng() * (worldWidth - 1200);
      y = 600 + rng() * (worldHeight - 1200);
      tries++;
    } while (
      tries < 200 &&
      (Math.hypot(x - worldWidth / 2, y - worldHeight / 2) < 1000 ||
        islands.some((isl) => Math.hypot(x - isl.x, y - isl.y) < 600))
    );
    islands.push(new Island(x, y, i < 4, rng));
  }
  return islands;
}

// Lerp utility for guest interpolation
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Angle lerp (handles wrapping)
export function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
