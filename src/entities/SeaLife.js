import { Particle } from './Particle';

export class SeaLife {
  constructor(x, y, type, groupLeader = null) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.angle = groupLeader ? groupLeader.angle : Math.random() * Math.PI * 2;
    this.speed = type === 'dolphin' ? 0.9 : 0.25;
    this.life = 1500;
    this.maxLife = 1500;
    this.phase = groupLeader
      ? groupLeader.phase + 0.8 + Math.random() * 2.5
      : Math.random() * Math.PI * 2;
  }

  update(islands, particles) {
    const nX = this.x + Math.cos(this.angle) * this.speed;
    const nY = this.y + Math.sin(this.angle) * this.speed;
    if (islands.some((isl) => isl.checkCollision(nX, nY, 20))) {
      this.angle += 0.4;
    } else {
      this.x = nX;
      this.y = nY;
    }
    this.life--;
    this.phase += this.type === 'dolphin' ? 0.05 : 0.02;
    if (this.type === 'whale' && Math.sin(this.phase) > 0.8 && Math.random() > 0.9) {
      particles.push(new Particle(this.x + 10, this.y, 'water', 2, 30, 0, -1));
    }
  }

  draw(ctx) {
    const alpha = Math.min(1, this.life / 100, (this.maxLife - this.life) / 100);
    const bodyV = Math.sin(this.phase);
    const tailV = Math.sin(this.phase - 1.3);
    if (alpha <= 0) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.globalAlpha = alpha;

    if (this.type === 'dolphin') {
      if (bodyV > 0) {
        ctx.globalAlpha = alpha * bodyV;
        // Body
        ctx.fillStyle = '#718096';
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        // Dorsal fin
        ctx.beginPath();
        ctx.moveTo(-1, 0);
        ctx.lineTo(-3, -4);
        ctx.lineTo(-2, 0);
        ctx.fill();
        // Tail fluke
        const tailFlap = Math.sin(this.phase * 2) * 1.5;
        ctx.fillStyle = '#5a6f80';
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.lineTo(-11, -3 + tailFlap);
        ctx.lineTo(-10, 0 + tailFlap * 0.3);
        ctx.lineTo(-11, 3 + tailFlap);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      if (bodyV > -0.3) {
        ctx.globalAlpha = alpha * Math.max(0, bodyV + 0.3);
        ctx.fillStyle = '#2d3748';
        ctx.beginPath();
        ctx.ellipse(0, 0, 24, 11, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (tailV > 0) {
        ctx.globalAlpha = alpha * tailV;
        ctx.fillStyle = '#1a202c';
        const ts = Math.sin(this.phase * 0.5) * 3;
        ctx.beginPath();
        ctx.moveTo(-20, 0);
        ctx.quadraticCurveTo(-28, -14 + ts, -38, -12 + ts);
        ctx.quadraticCurveTo(-32, ts, -38, 12 + ts);
        ctx.quadraticCurveTo(-28, 14 + ts, -20, 0);
        ctx.fill();
      }
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
