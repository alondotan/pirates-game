export class Particle {
  constructor(x, y, color, size, life, vx = null, vy = null) {
    this.x = x;
    this.y = y;
    this.vx = vx !== null ? vx : (Math.random() - 0.5) * 1.2;
    this.vy = vy !== null ? vy : (Math.random() - 0.5) * 1.2;
    this.color = color;
    this.size = size;
    this.life = life;
    this.maxLife = life;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    if (this.color === 'smoke') this.size += 0.04;
  }

  draw(ctx) {
    ctx.globalAlpha = this.life / this.maxLife;
    if (this.color === 'fire') ctx.fillStyle = Math.random() > 0.5 ? '#ff4500' : '#ffae00';
    else if (this.color === 'smoke') ctx.fillStyle = '#333';
    else if (this.color === 'water') ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    else ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
