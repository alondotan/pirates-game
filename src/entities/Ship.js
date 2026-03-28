import { SHIP_TYPES, FIRE_COOLDOWN_MAX, GRAVITY } from '../constants';
import { calculateRangeParams } from '../utils';
import { Cannonball } from './Cannonball';
import { Particle } from './Particle';

let _nextId = 1;

export class Ship {
  constructor(x, y, typeId, isPlayer = false, id = null) {
    this.id = id || `ship_${_nextId++}`;
    this.typeId = typeId;
    this.type = SHIP_TYPES[typeId];
    this.x = x;
    this.y = y;
    this.angle = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.health = this.type.health;
    this.maxHealth = this.type.health;
    this.isPlayer = isPlayer;
    this.playerColor = null; // set for multiplayer player ships
    this.cooldownL = 0;
    this.cooldownR = 0;
    this.isSinking = false;
    this.sinkProgress = 0;
  }

  update(islands, player, cannonballsList, particlesList, wind) {
    if (this.isSinking) {
      this.sinkProgress += 0.003;
      if (Math.random() > 0.4)
        particlesList.push(
          new Particle(
            this.x + (Math.random() - 0.5) * 40,
            this.y + (Math.random() - 0.5) * 40,
            'fire',
            4,
            30
          )
        );
      if (Math.random() > 0.2)
        particlesList.push(
          new Particle(
            this.x + (Math.random() - 0.5) * 40,
            this.y + (Math.random() - 0.5) * 40,
            'smoke',
            5,
            80,
            0,
            -1.2
          )
        );
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
      if (!this.targetAngle || Math.random() < 0.005)
        this.targetAngle = Math.random() * Math.PI * 2;
      let d = this.targetAngle - this.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.angle += d * 0.007;
      this.speed = 0.15 + Math.random() * 0.15;
      if (
        player &&
        !player.isSinking &&
        Math.hypot(this.x - player.x, this.y - player.y) < 700 &&
        Math.random() < 0.006
      ) {
        this.fire(Math.random() > 0.5 ? 'left' : 'right', 5, cannonballsList);
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

    if (this.health < this.maxHealth * 0.95 && Math.random() > 0.85)
      particlesList.push(new Particle(this.x, this.y, 'smoke', 2, 40, 0, -0.6));
    if (this.health < this.maxHealth * 0.5 && Math.random() > 0.85)
      particlesList.push(new Particle(this.x, this.y, 'fire', 3, 20));
  }

  fire(side, power, cannonballsList) {
    if (!cannonballsList || this.isSinking) return;
    if (side === 'left' && this.cooldownL > 0) return;
    if (side === 'right' && this.cooldownR > 0) return;

    const angle = side === 'left' ? this.angle - Math.PI / 2 : this.angle + Math.PI / 2;
    if (this.type.cannons === 1) {
      cannonballsList.push(new Cannonball(this.x, this.y, angle, power, this));
    } else {
      const oX = Math.cos(this.angle) * 16;
      const oY = Math.sin(this.angle) * 16;
      cannonballsList.push(new Cannonball(this.x + oX, this.y + oY, angle, power, this));
      cannonballsList.push(new Cannonball(this.x - oX, this.y - oY, angle, power, this));
    }
    if (side === 'left') this.cooldownL = FIRE_COOLDOWN_MAX;
    else this.cooldownR = FIRE_COOLDOWN_MAX;
  }

  draw(ctx, isAimingL, aimPowerL, isAimingR, aimPowerR) {
    if (this.sinkProgress >= 1) return;

    if (this.isPlayer && !this.isSinking) {
      const drawArc = (side, power) => {
        const p = calculateRangeParams(power);
        const a = side === 'left' ? this.angle - Math.PI / 2 : this.angle + Math.PI / 2;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        for (let i = 0; i <= p.timeToHit; i += 3) {
          const cx = this.x + Math.cos(a) * p.vH * i;
          const cy = this.y + Math.sin(a) * p.vH * i;
          const cz = p.vV * i - 0.5 * GRAVITY * i * i;
          if (i === 0) ctx.moveTo(cx, cy - cz);
          else ctx.lineTo(cx, cy - cz);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(this.x + Math.cos(a) * p.dist, this.y + Math.sin(a) * p.dist, 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      };
      if (isAimingL) drawArc('left', aimPowerL);
      if (isAimingR) drawArc('right', aimPowerR);
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle + (this.isSinking ? Math.sin(this.sinkProgress * 40) * 0.05 : 0));
    ctx.scale(this.type.sizeScale, this.type.sizeScale);
    ctx.globalAlpha = 1 - this.sinkProgress;
    const hullColor = this.isPlayer ? (this.playerColor || this.type.color) : '#c53030';
    Ship.drawHull(ctx, hullColor);
    Ship.drawSails(ctx, this.type, this.isPlayer);
    ctx.restore();

    if (!this.isSinking) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(this.x - 15, this.y - 45, 30, 3);
      ctx.fillStyle = this.isPlayer ? '#22c55e' : '#ef4444';
      ctx.fillRect(this.x - 15, this.y - 45, (this.health / this.maxHealth) * 30, 3);
    }
  }

  static drawSail(ctx, x, w, c, isPlayer) {
    ctx.strokeStyle = '#3e2723';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, -w);
    ctx.lineTo(x, w);
    ctx.stroke();
    ctx.fillStyle = isPlayer ? '#111' : '#2d1b1b';
    ctx.beginPath();
    ctx.moveTo(x, -w);
    ctx.quadraticCurveTo(x + c, 0, x, w);
    ctx.lineTo(x, -w);
    ctx.fill();
  }

  static drawSails(ctx, type, isPlayer) {
    const isGalleon = type.cannons === 2;
    const sw = isGalleon ? 28 : 24;
    Ship.drawSail(ctx, 2, sw, 15, isPlayer);
    Ship.drawSail(ctx, 14, 11, 8, isPlayer);
    Ship.drawSail(ctx, -11, 13, 9, isPlayer);
    if (isGalleon) {
      Ship.drawSail(ctx, -20, 10, 7, isPlayer);
    }
  }

  static drawHull(ctx, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = '#1a0d00';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-24, -3.5);
    ctx.quadraticCurveTo(0, -10, 22, -1.8);
    ctx.lineTo(36, 0);
    ctx.lineTo(22, 1.8);
    ctx.quadraticCurveTo(0, 10, -24, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#3e2723';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(38, 0);
    ctx.stroke();

    ctx.fillStyle = '#3e2723';
    ctx.beginPath();
    ctx.arc(-6, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  static drawPreview(ctx, x, y, type, scale = 2.5) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 6);
    ctx.scale(scale * type.sizeScale, scale * type.sizeScale);
    Ship.drawHull(ctx, type.color);
    Ship.drawSails(ctx, type, true);
    ctx.restore();
  }
}
