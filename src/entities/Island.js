import { Cannonball } from './Cannonball';

export class Island {
  constructor(x, y, isFortress = false, rng = null) {
    const rand = rng || Math.random;
    this.x = x;
    this.y = y;
    this.isFortress = isFortress;
    this.cooldown = 0;
    this.wavePhase = rand() * Math.PI * 2;

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
    }

    this.palms = Array.from({ length: 15 }, () => {
      const c = this.circles[Math.floor(rand() * this.circles.length)];
      const a = rand() * Math.PI * 2;
      return {
        lx: c.ox + Math.cos(a) * c.r * 0.85,
        ly: c.oy + Math.sin(a) * c.r * 0.85,
        leaves: 5 + Math.floor(rand() * 3),
        rot: rand() * Math.PI * 2,
      };
    });

    // Round bushes/trees — denser toward center
    const TREE_COLORS = ['#1b4d1b', '#2d6a2d', '#3a7a3a', '#4a8c3a', '#1e5e2e', '#356b2b'];
    this.trees = [];
    for (const c of this.circles) {
      const density = 12 + Math.floor(rand() * 8);
      for (let i = 0; i < density; i++) {
        const dist = rand() * 0.75;
        const a = rand() * Math.PI * 2;
        const size = 4 + rand() * 7 * (1 - dist);
        this.trees.push({
          tx: c.ox + Math.cos(a) * c.r * dist,
          ty: c.oy + Math.sin(a) * c.r * dist,
          r: size,
          color: TREE_COLORS[Math.floor(rand() * TREE_COLORS.length)],
        });
      }
    }
    this.trees.sort((a, b) => a.ty - b.ty);
  }

  checkCollision(tx, ty, p = 15) {
    return this.circles.some(
      (c) => Math.hypot(tx - (this.x + c.ox), ty - (this.y + c.oy)) < c.r + p
    );
  }

  update(ships, cannonballsList) {
    this.wavePhase += 0.04;
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
        new Cannonball(
          this.fortX,
          this.fortY,
          Math.atan2(target.y - this.fortY, target.x - this.fortX),
          7,
          this
        )
      );
      this.cooldown = 160;
    }
  }

  draw(ctx) {
    const wave = Math.sin(this.wavePhase) * 6 + 10;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    this.circles.forEach((c) => {
      ctx.beginPath();
      ctx.arc(this.x + c.ox, this.y + c.oy, c.r + wave, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#f2d2a9';
    this.circles.forEach((c) => {
      ctx.beginPath();
      ctx.arc(this.x + c.ox, this.y + c.oy, c.r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#c19a6b';
    this.circles.forEach((c) => {
      ctx.beginPath();
      ctx.arc(this.x + c.ox, this.y + c.oy, c.r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    });

    this.trees.forEach((t) => {
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(this.x + t.tx, this.y + t.ty, t.r, 0, Math.PI * 2);
      ctx.fill();
    });

    this.palms.forEach((p) => {
      const tx = this.x + p.lx;
      const ty = this.y + p.ly;
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + 1, ty - 14);
      ctx.stroke();
      ctx.fillStyle = '#2d5a27';
      for (let i = 0; i < p.leaves; i++) {
        ctx.save();
        ctx.translate(tx + 1, ty - 14);
        ctx.rotate(p.rot + (i / p.leaves) * Math.PI * 2);
        ctx.beginPath();
        ctx.ellipse(7, 0, 9, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    if (this.isFortress) {
      ctx.save();
      ctx.translate(this.fortX, this.fortY);
      ctx.fillStyle = '#718096';
      ctx.strokeStyle = '#2d3748';
      ctx.lineWidth = 2;
      ctx.fillRect(-20, -20, 40, 40);
      ctx.strokeRect(-20, -20, 40, 40);
      ctx.fillStyle = '#2d3748';
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1a202c';
      ctx.fillRect(-8, -5, 4, 6);
      ctx.fillRect(4, -5, 4, 6);
      ctx.fillStyle = '#e53e3e';
      const fw = 20 + Math.sin(Date.now() * 0.005) * 5;
      ctx.beginPath();
      ctx.moveTo(0, -25);
      ctx.quadraticCurveTo(fw / 2, -32, fw, -25);
      ctx.lineTo(fw, -15);
      ctx.quadraticCurveTo(fw / 2, -22, 0, -15);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(0, -45);
      ctx.stroke();
      ctx.restore();
    }
  }
}
