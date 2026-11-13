// Particle effects and screen shake for AI-Bomberman

import { SerializedFxEvent } from './network';

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

export interface SlashEffect {
  x: number;
  y: number;
  angle: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
  flip: boolean;
}

export class ParticleManager {
  private static readonly MAX_PARTICLES = 160;
  private static readonly MAX_SLASHES = 24;

  public particles: Particle[] = [];
  public slashes: SlashEffect[] = [];
  public shakeDuration: number = 0;
  public shakeIntensity: number = 0;
  public recordFxEvents: boolean = false;
  private pendingFxEvents: SerializedFxEvent[] = [];

  public reset() {
    this.particles = [];
    this.slashes = [];
    this.shakeDuration = 0;
    this.shakeIntensity = 0;
    this.pendingFxEvents = [];
  }

  private pushParticle(p: Particle) {
    if (this.particles.length >= ParticleManager.MAX_PARTICLES) {
      // Overwrite oldest particle to avoid allocation/GC spike
      this.particles[Math.floor(Math.random() * 24)] = p;
      return;
    }
    this.particles.push(p);
  }

  private pushFxEvent(ev: SerializedFxEvent) {
    if (!this.recordFxEvents) return;
    if (this.pendingFxEvents.length < 64) {
      this.pendingFxEvents.push(ev);
    }
  }

  public consumePendingFxEvents(): SerializedFxEvent[] {
    if (this.pendingFxEvents.length === 0) return [];
    const events = this.pendingFxEvents;
    this.pendingFxEvents = [];
    return events;
  }

  public replayFxEvents(events?: SerializedFxEvent[]) {
    if (!events || events.length === 0) return;
    const prevRecord = this.recordFxEvents;
    this.recordFxEvents = false;
    try {
      for (const ev of events) {
        switch (ev.kind) {
          case 'shake':
            this.triggerShake(ev.intensity, ev.duration);
            break;
          case 'explosion':
            this.addExplosionParticles(ev.x, ev.y, ev.count ?? 16);
            break;
          case 'debris':
            this.addBlockDebris(ev.x, ev.y, ev.count ?? 12);
            break;
          case 'itemGet':
            this.addItemGetParticles(ev.x, ev.y, ev.color ?? '#facc15');
            break;
          case 'slash':
            this.addSlashEffect(
              ev.x,
              ev.y,
              ev.angle,
              ev.radius ?? 38,
              ev.color ?? '#38bdf8',
              Boolean(ev.flip)
            );
            break;
        }
      }
    } finally {
      this.recordFxEvents = prevRecord;
    }
  }

  public triggerShake(intensity: number = 6, duration: number = 14) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
    this.pushFxEvent({ kind: 'shake', intensity, duration });
  }

  public addExplosionParticles(px: number, py: number, count: number = 16) {
    this.pushFxEvent({ kind: 'explosion', x: Math.round(px), y: Math.round(py), count });
    const colors = ['#f97316', '#fbbf24', '#f43f5e', '#ffffff', '#e11d48'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4.5;
      const life = 18 + Math.floor(Math.random() * 16);
      this.pushParticle({
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
    this.pushFxEvent({ kind: 'debris', x: Math.round(px), y: Math.round(py), count });
    const brickColors = ['#b45309', '#92400e', '#78350f', '#d97706'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * 3.5;
      const life = 20 + Math.floor(Math.random() * 15);
      this.pushParticle({
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
    this.pushFxEvent({ kind: 'itemGet', x: Math.round(px), y: Math.round(py), color });
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.2;
      const speed = 2.0 + Math.random() * 2.5;
      const life = 22 + Math.floor(Math.random() * 10);
      this.pushParticle({
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

  public addSlashEffect(
    px: number,
    py: number,
    angle: number,
    radius: number = 38,
    color: string = '#38bdf8',
    flip: boolean = false
  ) {
    this.pushFxEvent({
      kind: 'slash',
      x: Math.round(px),
      y: Math.round(py),
      angle: Math.round(angle * 100) / 100,
      radius,
      color,
      flip,
    });
    const life = 12;
    if (this.slashes.length >= ParticleManager.MAX_SLASHES) {
      this.slashes.shift();
    }
    this.slashes.push({
      x: px,
      y: py,
      angle,
      radius,
      color,
      life,
      maxLife: life,
      flip,
    });

    // Accompanying sword sparks
    for (let i = 0; i < 5; i++) {
      const a = angle + (Math.random() - 0.5) * 1.4;
      const spd = 2.0 + Math.random() * 3.5;
      const pLife = 10 + Math.floor(Math.random() * 8);
      this.pushParticle({
        x: px + Math.cos(a) * (radius * 0.4),
        y: py + Math.sin(a) * (radius * 0.4),
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        size: 2.5 + Math.random() * 2,
        color: i % 2 === 0 ? '#ffffff' : color,
        alpha: 1.0,
        life: pLife,
        maxLife: pLife,
        shape: 'spark',
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

    // Particles update with O(1) swap-and-pop removal
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
        const lastIdx = this.particles.length - 1;
        if (i !== lastIdx) {
          this.particles[i] = this.particles[lastIdx];
        }
        this.particles.pop();
      }
    }

    // Slashes update with O(1) swap-and-pop removal
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      this.slashes[i].life--;
      if (this.slashes[i].life <= 0) {
        const lastIdx = this.slashes.length - 1;
        if (i !== lastIdx) {
          this.slashes[i] = this.slashes[lastIdx];
        }
        this.slashes.pop();
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
    if (this.particles.length === 0 && this.slashes.length === 0) return;

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

    // Render sharp crescent slash arcs (using layered strokes instead of shadowBlur)
    for (const s of this.slashes) {
      const progress = 1 - s.life / s.maxLife;
      const alpha = Math.max(0, s.life / s.maxLife);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      if (s.flip) ctx.scale(1, -1);

      ctx.lineCap = 'round';
      ctx.strokeStyle = s.color;

      // Soft outer halo stroke (replaces expensive shadowBlur)
      ctx.globalAlpha = alpha * 0.32;
      ctx.lineWidth = 13 * (1 - progress * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, s.radius, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();

      // Main blade arc
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 6.5 * (1 - progress * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, s.radius, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();

      // Inner white hot blade core
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * (1 - progress * 0.4);
      ctx.beginPath();
      ctx.arc(2, 0, s.radius * 0.96, -Math.PI * 0.36, Math.PI * 0.36);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }
}
