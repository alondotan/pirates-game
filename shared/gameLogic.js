// shared/gameLogic.js — Pure game simulation (NO Canvas/DOM/React)
// Runs on both server (Node.js) and client (browser via Vite)

// ─── Constants ───────────────────────────────────────────────────────────────

export const WORLD = { width: 5000, height: 5000 };
export const FIRE_COOLDOWN_MAX = 120;
export const GRAVITY = 0.05;
export const BROADCAST_INTERVAL = 3;
export const MAX_PLAYERS = 4;
export const PLAYER_COLORS = ['#5d4037', '#1565c0', '#2e7d32', '#6a1b9a'];

export const SHIP_TYPES = {
  sloop: {
    name: 'Sloop',
    color: '#5d4037',
    maxSpeed: 0.5,
    rotSpeed: 0.008,
    acceleration: 0.01,
    health: 100,
    cannons: 1,
    sizeScale: 1,
  },
  galleon: {
    name: 'Galleon',
    color: '#4e342e',
    maxSpeed: 0.35,
    rotSpeed: 0.006,
    acceleration: 0.007,
    health: 160,
    cannons: 2,
    sizeScale: 1.25,
  },
};

// ─── Utilities ───────────────────────────────────────────────────────────────

export function calculateRangeParams(power) {
  const vH = 0.7 + power * 0.35;
  const vV = power * 0.25;
  const timeToHit = (2 * vV) / GRAVITY;
  return { vH, vV, timeToHit, dist: vH * timeToHit };
}

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── ID generators ──────────────────────────────────────────────────────────

let _nextShipId = 1;
let _nextCbId = 1;

export function resetIds() {
  _nextShipId = 1;
  _nextCbId = 1;
}

// ─── CannonballSim ──────────────────────────────────────────────────────────

export class CannonballSim {
  constructor(x, y, angle, power, ownerId) {
    this.id = `cb_${_nextCbId++}`;
    this.x = x;
    this.y = y;
    this.ownerId = ownerId;
    const p = calculateRangeParams(power);
    this.vx = Math.cos(angle) * p.vH;
    this.vy = Math.sin(angle) * p.vH;
    this.z = 0;
    this.vz = p.vV;
    this.active = true;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vz -= GRAVITY;
    this.z += this.vz;
    if (this.z <= 0) {
      this.active = false;
      return false;
    }
    return true;
  }

  serialize() {
    return {
      id: this.id,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      z: Math.round(this.z * 100) / 100,
      vx: Math.round(this.vx * 1000) / 1000,
      vy: Math.round(this.vy * 1000) / 1000,
      vz: Math.round(this.vz * 1000) / 1000,
      ownerId: this.ownerId,
    };
  }
}

// ─── ShipSim ────────────────────────────────────────────────────────────────

export class ShipSim {
  constructor(x, y, typeId, isPlayer = false, id = null) {
    this.id = id || `ship_${_nextShipId++}`;
    this.typeId = typeId;
    this.type = SHIP_TYPES[typeId];
    this.x = x;
    this.y = y;
    this.angle = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.health = this.type.health;
    this.maxHealth = this.type.health;
    this.isPlayer = isPlayer;
    this.playerColor = null;
    this.cooldownL = 0;
    this.cooldownR = 0;
    this.isSinking = false;
    this.sinkProgress = 0;

    // AI state
    this.targetAngle = null;

    // Player input state (set by applyInput)
    this.inputForward = false;
    this.inputLeft = false;
    this.inputRight = false;
    this.inputFireLeft = false;
    this.inputFireRight = false;
    this.inputFirePowerL = 5;
    this.inputFirePowerR = 5;
  }

  update(islands, allPlayerShips, cannonballsList, wind) {
    if (this.isSinking) {
      this.sinkProgress += 0.003;
      return;
    }
    if (this.health <= 0) {
      this.isSinking = true;
      return;
    }

    const angleDiff = Math.abs(this.angle - wind.angle) % (Math.PI * 2);
    const windEffect =
      angleDiff < Math.PI / 2 || angleDiff > (3 * Math.PI) / 2 ? 1.2 : 0.7;

    if (!this.isPlayer) {
      // AI logic
      if (!this.targetAngle || Math.random() < 0.005) {
        this.targetAngle = Math.random() * Math.PI * 2;
      }
      let d = this.targetAngle - this.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.angle += d * 0.007;
      this.speed = 0.15 + Math.random() * 0.15;

      // Find nearest alive player ship
      let nearestPlayer = null;
      let nearestDist = Infinity;
      for (const ps of allPlayerShips) {
        if (ps.isSinking || ps.health <= 0) continue;
        const dist = Math.hypot(this.x - ps.x, this.y - ps.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPlayer = ps;
        }
      }

      if (nearestPlayer && nearestDist < 700 && Math.random() < 0.006) {
        this.fire(Math.random() > 0.5 ? 'left' : 'right', 5, cannonballsList);
      }
    } else {
      // Player ship — apply stored inputs
      if (this.inputLeft) this.angle -= this.type.rotSpeed;
      if (this.inputRight) this.angle += this.type.rotSpeed;
      if (this.inputForward) {
        this.speed = Math.min(this.speed + this.type.acceleration, this.type.maxSpeed);
      }
      if (this.inputFireLeft) {
        this.fire('left', this.inputFirePowerL, cannonballsList);
        this.inputFireLeft = false;
      }
      if (this.inputFireRight) {
        this.fire('right', this.inputFirePowerR, cannonballsList);
        this.inputFireRight = false;
      }
    }

    this.speed *= 0.995;
    const s = this.speed * windEffect;
    const nextX = this.x + Math.cos(this.angle) * s;
    const nextY = this.y + Math.sin(this.angle) * s;
    if (islands.some((isl) => isl.checkCollision(nextX, nextY, 15 * this.type.sizeScale))) {
      this.speed *= -0.2;
    } else {
      this.x = nextX;
      this.y = nextY;
    }

    if (this.cooldownL > 0) this.cooldownL--;
    if (this.cooldownR > 0) this.cooldownR--;
  }

  fire(side, power, cannonballsList) {
    if (!cannonballsList || this.isSinking) return;
    if (side === 'left' && this.cooldownL > 0) return;
    if (side === 'right' && this.cooldownR > 0) return;

    const angle = side === 'left' ? this.angle - Math.PI / 2 : this.angle + Math.PI / 2;
    if (this.type.cannons === 1) {
      cannonballsList.push(new CannonballSim(this.x, this.y, angle, power, this.id));
    } else {
      const oX = Math.cos(this.angle) * 16;
      const oY = Math.sin(this.angle) * 16;
      cannonballsList.push(new CannonballSim(this.x + oX, this.y + oY, angle, power, this.id));
      cannonballsList.push(new CannonballSim(this.x - oX, this.y - oY, angle, power, this.id));
    }
    if (side === 'left') this.cooldownL = FIRE_COOLDOWN_MAX;
    else this.cooldownR = FIRE_COOLDOWN_MAX;
  }

  serialize() {
    return {
      id: this.id,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      angle: Math.round(this.angle * 1000) / 1000,
      speed: Math.round(this.speed * 1000) / 1000,
      health: this.health,
      maxHealth: this.maxHealth,
      isSinking: this.isSinking,
      sinkProgress: Math.round(this.sinkProgress * 1000) / 1000,
      typeId: this.typeId,
      isPlayer: this.isPlayer,
      cooldownL: this.cooldownL,
      cooldownR: this.cooldownR,
      playerColor: this.playerColor,
    };
  }
}

// ─── IslandSim ──────────────────────────────────────────────────────────────

export class IslandSim {
  constructor(x, y, isFortress = false, rng = null) {
    const rand = rng || Math.random;
    this.x = x;
    this.y = y;
    this.isFortress = isFortress;
    this.cooldown = 0;

    const count = 4 + Math.floor(rand() * 4);
    this.circles = [];
    for (let i = 0; i < count; i++) {
      this.circles.push({
        ox: (rand() - 0.5) * 150,
        oy: (rand() - 0.5) * 150,
        r: 80 + rand() * 90,
      });
    }

    if (isFortress) {
      const c = this.circles[0];
      const a = rand() * Math.PI * 2;
      this.fortX = x + c.ox + Math.cos(a) * c.r * 0.88;
      this.fortY = y + c.oy + Math.sin(a) * c.r * 0.88;
    } else {
      this.fortX = 0;
      this.fortY = 0;
    }
  }

  checkCollision(tx, ty, p = 15) {
    return this.circles.some(
      (c) => Math.hypot(tx - (this.x + c.ox), ty - (this.y + c.oy)) < c.r + p
    );
  }

  update(ships, cannonballsList) {
    if (!this.isFortress) return;
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    const target = ships.find(
      (s) =>
        s.health > 0 &&
        !s.isSinking &&
        Math.hypot(this.fortX - s.x, this.fortY - s.y) < 1300
    );
    if (target) {
      cannonballsList.push(
        new CannonballSim(
          this.fortX,
          this.fortY,
          Math.atan2(target.y - this.fortY, target.x - this.fortX),
          7,
          `fortress_${this.x}_${this.y}`
        )
      );
      this.cooldown = 160;
    }
  }

  serialize() {
    return {
      x: this.x,
      y: this.y,
      isFortress: this.isFortress,
      fortX: this.fortX,
      fortY: this.fortY,
      circles: this.circles.map((c) => ({ ox: c.ox, oy: c.oy, r: c.r })),
    };
  }
}

// ─── Island generation (deterministic) ──────────────────────────────────────

export function generateSeededIslands(seed) {
  const rng = mulberry32(seed);
  const islands = [];
  for (let i = 0; i < 8; i++) {
    let x, y, tries = 0;
    do {
      x = 600 + rng() * (WORLD.width - 1200);
      y = 600 + rng() * (WORLD.height - 1200);
      tries++;
    } while (
      tries < 200 &&
      (Math.hypot(x - WORLD.width / 2, y - WORLD.height / 2) < 1000 ||
        islands.some((isl) => Math.hypot(x - isl.x, y - isl.y) < 600))
    );
    islands.push(new IslandSim(x, y, i < 4, rng));
  }
  return islands;
}

// ─── GameRoom — full game simulation for one room ───────────────────────────

const ENEMY_RESPAWN_DELAY = 480; // 8 seconds at 60fps
const ENEMY_COUNT = 6;

export class GameRoom {
  /**
   * @param {number} seed - deterministic seed for island/enemy generation
   * @param {Array<{id: string, shipType: string}>} players - joined players
   * @param {string} mode - 'coop' or 'ffa'
   */
  constructor(seed, players, mode) {
    this.seed = seed;
    this.mode = mode;
    this.tick_count = 0;
    this.score = 0;
    this.gameOver = false;
    this.gameOverReason = null;

    resetIds();

    // Wind
    this.wind = { angle: Math.random() * Math.PI * 2 };
    this.windChangeTimer = 0;

    // Generate islands deterministically
    this.islands = generateSeededIslands(seed);

    // Cannonballs list
    this.cannonballs = [];

    // Create player ships — spawn near center
    this.playerShips = new Map(); // playerId -> ShipSim
    const cx = WORLD.width / 2;
    const cy = WORLD.height / 2;
    players.forEach((p, idx) => {
      const spawnAngle = (idx / players.length) * Math.PI * 2;
      const spawnDist = 150;
      const ship = new ShipSim(
        cx + Math.cos(spawnAngle) * spawnDist,
        cy + Math.sin(spawnAngle) * spawnDist,
        p.shipType || 'sloop',
        true,
        p.id
      );
      ship.angle = spawnAngle + Math.PI; // face center
      ship.playerColor = PLAYER_COLORS[idx % PLAYER_COLORS.length];
      this.playerShips.set(p.id, ship);
    });

    // Create enemy ships
    const rng = mulberry32(seed + 999);
    this.enemies = [];
    this.deadEnemies = []; // { timer, typeId } for respawn queue
    for (let i = 0; i < ENEMY_COUNT; i++) {
      this._spawnEnemy(rng);
    }
  }

  _spawnEnemy(rng) {
    const rand = rng || Math.random;
    let x, y, tries = 0;
    do {
      x = 400 + rand() * (WORLD.width - 800);
      y = 400 + rand() * (WORLD.height - 800);
      tries++;
    } while (
      tries < 100 &&
      (Math.hypot(x - WORLD.width / 2, y - WORLD.height / 2) < 600 ||
        this.islands.some((isl) => isl.checkCollision(x, y, 80)))
    );
    const typeId = rand() > 0.6 ? 'galleon' : 'sloop';
    const enemy = new ShipSim(x, y, typeId, false);
    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * Apply player input to their ship
   */
  applyInput(playerId, inputData) {
    const ship = this.playerShips.get(playerId);
    if (!ship || ship.isSinking) return;

    if (inputData.forward !== undefined) ship.inputForward = inputData.forward;
    if (inputData.left !== undefined) ship.inputLeft = inputData.left;
    if (inputData.right !== undefined) ship.inputRight = inputData.right;
    if (inputData.fireLeft) {
      ship.inputFireLeft = true;
      ship.inputFirePowerL = inputData.firePowerL || 5;
    }
    if (inputData.fireRight) {
      ship.inputFireRight = true;
      ship.inputFirePowerR = inputData.firePowerR || 5;
    }
  }

  /**
   * One frame of simulation
   */
  tick() {
    if (this.gameOver) return;
    this.tick_count++;

    // Wind update — slowly drift
    this.windChangeTimer--;
    if (this.windChangeTimer <= 0) {
      this.wind.angle += (Math.random() - 0.5) * 0.3;
      this.windChangeTimer = 300 + Math.floor(Math.random() * 300);
    }

    // Collect all player ships as array for AI targeting
    const allPlayerShipsArr = Array.from(this.playerShips.values());

    // Update player ships
    for (const ship of this.playerShips.values()) {
      ship.update(this.islands, allPlayerShipsArr, this.cannonballs, this.wind);
    }

    // Update enemy ships
    for (const enemy of this.enemies) {
      enemy.update(this.islands, allPlayerShipsArr, this.cannonballs, this.wind);
    }

    // Update islands (fortress firing)
    // Fortresses target all ships (players in any mode)
    const allShips = [...allPlayerShipsArr, ...this.enemies];
    for (const island of this.islands) {
      island.update(allShips, this.cannonballs);
    }

    // Update cannonballs
    for (let i = this.cannonballs.length - 1; i >= 0; i--) {
      const cb = this.cannonballs[i];
      const alive = cb.update();
      if (!alive) {
        this.cannonballs.splice(i, 1);
        continue;
      }

      // Collision detection — only when descending and low altitude
      if (cb.vz >= 0 || cb.z >= 10) continue;

      // Check hits against all ships
      for (const ship of allShips) {
        if (ship.isSinking || ship.health <= 0) continue;
        if (cb.ownerId === ship.id) continue; // can't hit yourself

        // In coop mode, player cannonballs don't hit other players
        if (this.mode === 'coop') {
          const ownerIsPlayer = this.playerShips.has(cb.ownerId);
          const targetIsPlayer = ship.isPlayer;
          if (ownerIsPlayer && targetIsPlayer) continue;
        }

        const dist = Math.hypot(cb.x - ship.x, cb.y - ship.y);
        if (dist < 30) {
          // Determine damage: fortress = 35, ship = 45
          const isFortressShot = typeof cb.ownerId === 'string' && cb.ownerId.startsWith('fortress_');
          const damage = isFortressShot ? 35 : 45;
          ship.health -= damage;
          cb.active = false;
          this.cannonballs.splice(i, 1);
          break;
        }
      }
    }

    // Handle dead enemies — remove fully sunk, queue respawn
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.isSinking && e.sinkProgress >= 1) {
        this.score += 100;
        this.deadEnemies.push({ timer: ENEMY_RESPAWN_DELAY, typeId: e.typeId });
        this.enemies.splice(i, 1);
      }
    }

    // Respawn timer
    for (let i = this.deadEnemies.length - 1; i >= 0; i--) {
      this.deadEnemies[i].timer--;
      if (this.deadEnemies[i].timer <= 0) {
        this._spawnEnemy();
        this.deadEnemies.splice(i, 1);
      }
    }

    // Handle dead player ships
    for (const [pid, ship] of this.playerShips) {
      if (ship.isSinking && ship.sinkProgress >= 1) {
        // Mark as fully dead — keep in map so we still track them but they are inactive
        ship.sinkProgress = 1; // clamp
      }
    }

    // Check game over conditions
    this._checkGameOver(allPlayerShipsArr);
  }

  _checkGameOver(allPlayerShipsArr) {
    const alivePlayers = allPlayerShipsArr.filter(
      (s) => !s.isSinking && s.health > 0
    );

    if (this.mode === 'coop') {
      // Coop: game over when all players are dead
      if (alivePlayers.length === 0) {
        this.gameOver = true;
        this.gameOverReason = 'all_dead';
      }
    } else {
      // FFA: game over when one player left (or zero if simultaneous kills)
      const totalPlayers = allPlayerShipsArr.length;
      if (totalPlayers > 1 && alivePlayers.length <= 1) {
        this.gameOver = true;
        this.gameOverReason = alivePlayers.length === 1
          ? `winner:${alivePlayers[0].id}`
          : 'draw';
      }
    }
  }

  /**
   * Mark a disconnected player's ship as sinking
   */
  markPlayerDisconnected(playerId) {
    const ship = this.playerShips.get(playerId);
    if (ship && !ship.isSinking) {
      ship.health = 0;
      ship.isSinking = true;
    }
  }

  /**
   * Serialize full state for broadcast
   */
  getState() {
    const allShips = [
      ...Array.from(this.playerShips.values()).map((s) => s.serialize()),
      ...this.enemies.map((s) => s.serialize()),
    ];

    return {
      type: 'state',
      ships: allShips,
      cannonballs: this.cannonballs.map((c) => c.serialize()),
      islands: this.islands.map((isl) => isl.serialize()),
      wind: Math.round(this.wind.angle * 1000) / 1000,
      score: this.score,
      mode: this.mode,
      gameOver: this.gameOver,
      gameOverReason: this.gameOverReason,
      tick: this.tick_count,
    };
  }
}
