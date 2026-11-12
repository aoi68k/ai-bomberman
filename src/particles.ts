// Particle effects and screen shake for AI-Bomberman

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  shape: 'circle' | 'square' | 'spark';
  gravity?: number;
}

export class ParticleManager {
  public particles: Particle[] = [];
  public shakeDuration: number = 0;
  public shakeIntensity: number = 0;

  public reset() {
    this.particles = [];
    this.shakeDuration = 0;
    this.shakeIntensity = 0;
  }

  public triggerShake(intensity: number = 6, duration: number = 14) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
  }

  public addExplosionParticles(px: number, py: number, count: number = 16) {
    const colors = ['#f97316', '#fbbf24', '#f43f5e', '#ffffff', '#e11d48'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4.5;
      const life = 18 + Math.floor(Math.random() * 16);
      this.particles.push({
        x: px + (Math.random() - 0.5) * 16,
        y: py + (Math.random() - 0.5) * 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1.0,
        life,
        maxLife: life,
        shape: Math.random() < 0.4 ? 'circle' : 'spark',
        gravity: 0.05,
      });
    }
  }

  public addBlockDebris(px: number, py: number, count: number = 12) {
    const brickColors = ['#b45309', '#92400e', '#78350f', '#d97706'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * 3.5;
      const life = 20 + Math.floor(Math.random() * 15);
      this.particles.push({
        x: px + (Math.random() - 0.5) * 20,
        y: py + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5, // Initial upward pop
        size: 4 + Math.random() * 4,
        color: brickColors[Math.floor(Math.random() * brickColors.length)],
        alpha: 1.0,
        life,
        maxLife: life,
        shape: 'square',
        gravity: 0.18,
      });
    }
  }

  public addItemGetParticles(px: number, py: number, color: string = '#facc15') {
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.2;
      const speed = 2.0 + Math.random() * 2.5;
      const life = 24 + Math.floor(Math.random() * 10);
      this.particles.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 3,
        color: Math.random() < 0.3 ? '#ffffff' : color,
        alpha: 1.0,
        life,
        maxLife: life,
        shape: 'spark',
        gravity: -0.04, // Float upward slightly
      });
    }
  }

  public update() {
    // Screen shake update
    if (this.shakeDuration > 0) {
      this.shakeDuration--;
      if (this.shakeDuration <= 0) {
        this.shakeIntensity = 0;
      }
    }

    // Particles update
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.gravity) {
        p.vy += p.gravity;
      }
      p.life--;
      p.alpha = Math.max(0, p.life / p.maxLife);

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  public getShakeOffset(): { x: number; y: number } {
    if (this.shakeDuration <= 0 || this.shakeIntensity <= 0) {
      return { x: 0, y: 0 };
    }
    const factor = this.shakeDuration / 14;
    const currentAmp = this.shakeIntensity * factor;
    return {
      x: (Math.random() * 2 - 1) * currentAmp,
      y: (Math.random() * 2 - 1) * currentAmp,
    };
  }

  public render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;

      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'square') {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.shape === 'spark') {
        // Cross spark
        ctx.fillRect(p.x - p.size, p.y - p.size * 0.3, p.size * 2, p.size * 0.6);
        ctx.fillRect(p.x - p.size * 0.3, p.y - p.size, p.size * 0.6, p.size * 2);
      }
    }
    ctx.restore();
  }
}
