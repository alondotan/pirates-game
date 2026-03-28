import { SHIP_TYPES } from '../constants';
import { Ship } from '../entities/Ship';
import { lerp, lerpAngle } from './protocol';

// Manage guest-side ship instances from network state
export function syncShipsFromState(stateShips, localShips, myPlayerId) {
  const shipMap = new Map(localShips.map((s) => [s.id, s]));
  const result = [];

  for (const sd of stateShips) {
    let ship = shipMap.get(sd.id);
    if (!ship) {
      ship = new Ship(sd.x, sd.y, sd.typeId, sd.isPlayer, sd.id);
    }
    // Store previous position for interpolation
    ship._prevX = ship.x;
    ship._prevY = ship.y;
    ship._prevAngle = ship.angle;
    ship._targetX = sd.x;
    ship._targetY = sd.y;
    ship._targetAngle = sd.angle;
    ship._interpT = 0;

    ship.speed = sd.speed;
    ship.health = sd.health;
    ship.isSinking = sd.isSinking;
    ship.sinkProgress = sd.sinkProgress;
    ship.cooldownL = sd.cooldownL;
    ship.cooldownR = sd.cooldownR;
    ship.typeId = sd.typeId;
    ship.type = SHIP_TYPES[sd.typeId];
    ship.maxHealth = ship.type.health;
    ship.isPlayer = sd.isPlayer;
    result.push(ship);
  }
  return result;
}

// Interpolate ship positions between snapshots
export function interpolateShips(ships, dt) {
  for (const ship of ships) {
    if (ship._targetX === undefined) continue;
    ship._interpT = Math.min(1, (ship._interpT || 0) + dt);
    const t = ship._interpT;
    ship.x = lerp(ship._prevX, ship._targetX, t);
    ship.y = lerp(ship._prevY, ship._targetY, t);
    ship.angle = lerpAngle(ship._prevAngle, ship._targetAngle, t);
  }
}

// Sync cannonballs from network state (simple replacement, no interpolation needed for fast projectiles)
export function syncCannonballsFromState(stateCBs, localCBs) {
  // Just recreate — cannonballs are short-lived and fast
  return stateCBs.map((cbd) => {
    const cb = {
      id: cbd.id,
      x: cbd.x,
      y: cbd.y,
      z: cbd.z,
      vx: cbd.vx,
      vy: cbd.vy,
      vz: cbd.vz,
      active: cbd.active,
      ownerId: cbd.ownerId,
      // Minimal draw method
      draw(ctx) {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + 4, 3 + this.z / 10, 2 + this.z / 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(this.x, this.y - this.z);
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(0, 0, 2.5 * (1 + this.z / 45), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
      // Local physics prediction between snapshots
      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vz -= 0.05;
        this.z += this.vz;
      },
    };
    return cb;
  });
}
