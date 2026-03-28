import { GRAVITY } from '../constants';
import { calculateRangeParams } from '../utils';
import { Particle } from './Particle';

let _nextCbId = 1;

export class Cannonball {
  constructor(x, y, angle, power, owner) {
    this.id = `cb_${_nextCbId++}`;
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.ownerId = owner ? owner.id : null;
    const p = calculateRangeParams(power);
    this.vx = Math.cos(angle) * p.vH;
    this.vy = Math.sin(angle) * p.vH;
    this.z = 0;
    this.vz = p.vV;
    this.active = true;
  }

  update(particles) {
    this.x += this.vx;
    this.y += this.vy;
    this.vz -= GRAVITY;
    this.z += this.vz;
    if (this.z <= 0) {
      this.active = false;
      for (let i = 0; i < 8; i++) {
        particles.push(new Particle(this.x, this.y, 'water', 2.5, 25));
      }
    }
  }

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
  }
}
