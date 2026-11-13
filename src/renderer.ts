// Canvas 2D Renderer for AI-Bomberman

import {
  COLS,
  ROWS,
  TILE_SIZE,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  TILE,
  ITEM,
  ItemType,
  EXPLOSION_DURATION,
} from './constants';
import { GameMap } from './map';
import { BombManager, Bomb } from './bomb';
import { Player } from './player';
import { ParticleManager } from './particles';
import { assets } from './assets';

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get 2D rendering context');
    this.ctx = context;
  }

  public render(
    map: GameMap,
    bombManager: BombManager,
    players: Player[],
    particles: ParticleManager,
    timeRemaining: number, // in seconds
    round: number
  ) {
    const ctx = this.ctx;

    // Reset and clear
    ctx.save();
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Apply Screen Shake
    const shake = particles.getShakeOffset();
    if (shake.x !== 0 || shake.y !== 0) {
      ctx.translate(shake.x, shake.y);
    }

    // 1. Draw Arena Floor
    this.drawFloor(ctx);

    // 2. Draw Soft Blocks and Items on the ground
    this.drawItems(ctx, map);
    this.drawGridTiles(ctx, map);

    // 3. Draw Bombs
    this.drawBombs(ctx, bombManager.bombs);

    // 4. Draw Explosions
    this.drawExplosions(ctx, bombManager.explosions.cells);

    // 5. Draw Players (Sort by Y position so characters in front render over characters behind)
    const sortedPlayers = [...players].sort((a, b) => a.y - b.y);
    for (const p of sortedPlayers) {
      this.drawPlayer(ctx, p);
    }

    // 6. Draw Particles (on top of entities)
    particles.render(ctx);

    ctx.restore();
  }

  private drawFloor(ctx: CanvasRenderingContext2D) {
    const floorImg = assets.getImage('floor');
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        if (floorImg) {
          ctx.drawImage(floorImg, px, py, TILE_SIZE, TILE_SIZE);
        } else {
          const isEven = (x + y) % 2 === 0;
          ctx.fillStyle = isEven ? '#1e293b' : '#182234'; // High-contrast arcade arena slate
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

          // Subtle tile inner border
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
        }
      }
    }
  }

  private drawGridTiles(ctx: CanvasRenderingContext2D, map: GameMap) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const tile = map.getTile(x, y);
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        if (tile === TILE.WALL) {
          this.drawIndestructibleWall(ctx, px, py, x, y);
        } else if (tile === TILE.SOFT_BLOCK) {
          this.drawSoftBlock(ctx, px, py);
        }
      }
    }
  }

  private drawIndestructibleWall(ctx: CanvasRenderingContext2D, px: number, py: number, x: number, y: number) {
    const wallImg = assets.getImage('wall');
    if (wallImg) {
      ctx.drawImage(wallImg, px, py, TILE_SIZE, TILE_SIZE);
      return;
    }

    // 3D Metallic Block with Highlights and Shadows
    const isEdge = x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1;

    // Outer shadow
    ctx.fillStyle = '#090d16';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

    // Top face
    const grad = ctx.createLinearGradient(px, py, px, py + TILE_SIZE);
    grad.addColorStop(0, isEdge ? '#475569' : '#334155');
    grad.addColorStop(1, isEdge ? '#334155' : '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

    // Bevel highlights
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, 3); // Top highlight
    ctx.fillRect(px + 2, py + 2, 3, TILE_SIZE - 4); // Left highlight

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(px + 2, py + TILE_SIZE - 5, TILE_SIZE - 4, 3); // Bottom shadow
    ctx.fillRect(px + TILE_SIZE - 5, py + 2, 3, TILE_SIZE - 4); // Right shadow

    // Center metallic plate rivet details
    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.beginPath();
    ctx.arc(px + 8, py + 8, 2, 0, Math.PI * 2);
    ctx.arc(px + TILE_SIZE - 8, py + 8, 2, 0, Math.PI * 2);
    ctx.arc(px + 8, py + TILE_SIZE - 8, 2, 0, Math.PI * 2);
    ctx.arc(px + TILE_SIZE - 8, py + TILE_SIZE - 8, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawSoftBlock(ctx: CanvasRenderingContext2D, px: number, py: number) {
    const softBlockImg = assets.getImage('soft_block');
    if (softBlockImg) {
      ctx.drawImage(softBlockImg, px, py, TILE_SIZE, TILE_SIZE);
      return;
    }

    // Stylized Brick / Crate
    ctx.fillStyle = '#78350f'; // Dark base
    ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

    const grad = ctx.createLinearGradient(px, py, px, py + TILE_SIZE);
    grad.addColorStop(0, '#d97706');
    grad.addColorStop(1, '#b45309');
    ctx.fillStyle = grad;
    ctx.fillRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);

    // Brick lines
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 2;

    // Horizontal mortaring
    const midY = py + TILE_SIZE / 2;
    ctx.beginPath();
    ctx.moveTo(px + 3, midY);
    ctx.lineTo(px + TILE_SIZE - 3, midY);

    // Vertical mortaring top row
    ctx.moveTo(px + TILE_SIZE / 2, py + 3);
    ctx.lineTo(px + TILE_SIZE / 2, midY);

    // Vertical mortaring bottom row
    ctx.moveTo(px + TILE_SIZE * 0.25, midY);
    ctx.lineTo(px + TILE_SIZE * 0.25, py + TILE_SIZE - 3);
    ctx.moveTo(px + TILE_SIZE * 0.75, midY);
    ctx.lineTo(px + TILE_SIZE * 0.75, py + TILE_SIZE - 3);
    ctx.stroke();

    // Top highlight
    ctx.fillStyle = 'rgba(254, 240, 138, 0.35)';
    ctx.fillRect(px + 3, py + 3, TILE_SIZE - 6, 2);
  }

  private drawItems(ctx: CanvasRenderingContext2D, map: GameMap) {
    const now = Date.now();
    for (const item of map.activeItems) {
      const px = item.tileX * TILE_SIZE + TILE_SIZE / 2;
      const py = item.tileY * TILE_SIZE + TILE_SIZE / 2;

      // Floating bobbing animation
      const bob = Math.sin((now - item.spawnTime) / 220) * 3;

      ctx.save();
      ctx.translate(px, py + bob);

      // Glowing aura
      const auraGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, 20);
      auraGrad.addColorStop(0, 'rgba(250, 204, 21, 0.45)');
      auraGrad.addColorStop(1, 'rgba(250, 204, 21, 0)');
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();

      // Render Item Image or fallback to emoji card
      const itemImg = assets.getImage(`item_${item.type}`);
      if (itemImg) {
        ctx.drawImage(itemImg, -18, -18, 36, 36);
      } else {
        // Fallback: Item badge card + emoji
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-16, -16, 32, 32, 6);
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        switch (item.type) {
          case ITEM.BOMB_UP:
            ctx.fillText('💣', 0, 1);
            break;
          case ITEM.FIRE_UP:
            ctx.fillText('🔥', 0, 1);
            break;
          case ITEM.SPEED_UP:
            ctx.fillText('👟', 0, 1);
            break;
          case ITEM.KICK:
            ctx.fillText('🥊', 0, 1);
            break;
          case ITEM.SHIELD:
            ctx.fillText('🛡️', 0, 1);
            break;
        }
      }

      ctx.restore();
    }
  }

  private drawBombs(ctx: CanvasRenderingContext2D, bombs: Bomb[]) {
    const bombImg = assets.getImage('bomb');
    for (const bomb of bombs) {
      const px = bomb.pixelX;
      const py = bomb.pixelY;

      // Pulse rate accelerates as timer nears 0
      const pulseSpeed = bomb.timer < 45 ? 0.35 : 0.18;
      const pulseScale = 1.0 + Math.sin(bomb.timer * pulseSpeed) * (bomb.timer < 45 ? 0.15 : 0.08);

      ctx.save();
      ctx.translate(px, py);
      ctx.scale(pulseScale, pulseScale);

      // Floor shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 14, 15, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      if (bombImg) {
        // Red flashing state before detonation
        if (bomb.timer < 35 && Math.floor(bomb.timer / 4) % 2 === 0) {
          ctx.filter = 'hue-rotate(300deg) brightness(1.4)';
        }
        ctx.drawImage(bombImg, -TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
        ctx.filter = 'none';
        ctx.restore();
        continue;
      }

      // Bomb body (Sphere with 3D gradient fallback)
      const grad = ctx.createRadialGradient(-5, -6, 2, 0, 0, 17);
      if (bomb.timer < 35 && Math.floor(bomb.timer / 4) % 2 === 0) {
        // Red flashing state before detonation
        grad.addColorStop(0, '#fca5a5');
        grad.addColorStop(0.5, '#ef4444');
        grad.addColorStop(1, '#7f1d1d');
      } else {
        grad.addColorStop(0, '#64748b');
        grad.addColorStop(0.3, '#1e293b');
        grad.addColorStop(1, '#020617');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();

      // Metal fuse collar
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-4, -18, 8, 5);

      // Fuse string
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.quadraticCurveTo(4, -22, 6, -24);
      ctx.stroke();

      // Fuse spark
      const sparkColor = Math.random() < 0.5 ? '#f59e0b' : '#ffffff';
      ctx.fillStyle = sparkColor;
      ctx.beginPath();
      ctx.arc(6, -24, 2.5 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  private drawExplosions(ctx: CanvasRenderingContext2D, cells: Array<{ tileX: number; tileY: number; life: number; maxLife: number; direction: string }>) {
    for (const cell of cells) {
      const px = cell.tileX * TILE_SIZE;
      const py = cell.tileY * TILE_SIZE;
      const progress = cell.life / cell.maxLife; // 1 -> 0
      const alpha = Math.min(1.0, progress * 1.4);

      ctx.save();
      ctx.globalAlpha = alpha;

      const cx = px + TILE_SIZE / 2;
      const cy = py + TILE_SIZE / 2;

      // Outer orange flame
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, TILE_SIZE * 0.55);
      grad.addColorStop(0, '#ffffff'); // White hot core
      grad.addColorStop(0.3, '#fbbf24'); // Yellow
      grad.addColorStop(0.7, '#f97316'); // Orange
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)'); // Fading Red

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE * 0.52, 0, Math.PI * 2);
      ctx.fill();

      // Directional flame jets
      ctx.fillStyle = '#f59e0b';
      if (cell.direction === 'up' || cell.direction === 'down' || cell.direction === 'center') {
        ctx.fillRect(cx - 10, py, 20, TILE_SIZE);
      }
      if (cell.direction === 'left' || cell.direction === 'right' || cell.direction === 'center') {
        ctx.fillRect(px, cy - 10, TILE_SIZE, 20);
      }

      // Hot center spark
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, 6 * progress, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, p: Player) {
    if (!p.isAlive && p.deathTimer <= 0) return;

    ctx.save();
    ctx.translate(p.x, p.y);

    // Death animation: spin and shrink
    if (!p.isAlive) {
      const deathProgress = p.deathTimer / 60; // 1 -> 0
      ctx.rotate((1 - deathProgress) * Math.PI * 6);
      ctx.scale(deathProgress, deathProgress);
      ctx.globalAlpha = deathProgress;
    }

    // Invulnerability flashing
    if (p.invulnerableTimer > 0 && Math.floor(p.invulnerableTimer / 4) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }

    // Dizzy wobble when stunned
    if (p.isAlive && p.stunTimer > 0) {
      ctx.rotate(Math.sin(Date.now() / 90) * 0.12);
    }

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 16, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Walking leg bobbing
    const walkBob = p.isMoving ? Math.sin(p.animFrame * 0.25) * 2 : 0;

    // Check directional 2-frame motion sprite first, then fallback to idle / character / player
    const walkFrame = p.isMoving ? (Math.floor(p.animFrame / 8) % 2) : 0;
    const motionKey = `${p.config.charId}_${p.facing}_${walkFrame}`;
    const playerImg = assets.getImage(motionKey) ||
                      assets.getImage(`${p.config.charId}_${p.facing}_0`) ||
                      assets.getImage(`char_${p.config.charId}`) ||
                      assets.getImage(`player_${p.config.id}`);

    if (playerImg) {
      ctx.save();
      // Only flip horizontally if we fall back to a generic char_/player_ image facing left
      const isMotionImage = assets.hasImage(motionKey) || assets.hasImage(`${p.config.charId}_${p.facing}_0`);
      if (!isMotionImage && p.facing === 'left') {
        ctx.scale(-1, 1);
      }
      ctx.drawImage(playerImg, -TILE_SIZE / 2, -TILE_SIZE / 2 - 4 + walkBob, TILE_SIZE, TILE_SIZE);
      ctx.restore();
    } else {
      // Body (Suit)
      ctx.fillStyle = p.config.color;
      ctx.beginPath();
      ctx.roundRect(-10, -4 + walkBob, 20, 18, 6);
      ctx.fill();

      // Belt / Trim
      ctx.fillStyle = p.config.accentColor;
      ctx.fillRect(-10, 4 + walkBob, 20, 4);

      // Head / Helmet (Large rounded cute Bomberman shape)
      ctx.fillStyle = p.config.subColor;
      ctx.beginPath();
      ctx.arc(0, -12 + walkBob, 14, 0, Math.PI * 2);
      ctx.fill();

      // Visor / Face Area (Dark plate)
      ctx.fillStyle = '#0f172a';
      let visorOffsetX = 0;
      let visorOffsetY = -12 + walkBob;
      if (p.facing === 'left') visorOffsetX = -3;
      if (p.facing === 'right') visorOffsetX = 3;
      if (p.facing === 'up') visorOffsetY = -15 + walkBob;
      if (p.facing === 'down') visorOffsetY = -11 + walkBob;

      if (p.facing !== 'up') {
        ctx.beginPath();
        ctx.ellipse(visorOffsetX, visorOffsetY, 10, 7, 0, 0, Math.PI * 2);
        ctx.fill();

        // Cute Eyes
        ctx.fillStyle = '#38bdf8';
        const eyeSpacing = 4;
        ctx.beginPath();
        ctx.arc(visorOffsetX - eyeSpacing, visorOffsetY, 2.2, 0, Math.PI * 2);
        ctx.arc(visorOffsetX + eyeSpacing, visorOffsetY, 2.2, 0, Math.PI * 2);
        ctx.fill();

        // Eye highlights
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(visorOffsetX - eyeSpacing - 0.5, visorOffsetY - 0.5, 1, 0, Math.PI * 2);
        ctx.arc(visorOffsetX + eyeSpacing - 0.5, visorOffsetY - 0.5, 1, 0, Math.PI * 2);
        ctx.fill();
      }

      // Helmet Antenna Pom-Pom
      ctx.fillStyle = p.config.accentColor;
      ctx.beginPath();
      ctx.arc(0, -27 + walkBob, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shield Aura if active
    if (p.shield > 0) {
      const shieldPulse = Math.sin(Date.now() / 150) * 2;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#0284c7';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(0, -2, 22 + shieldPulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Tackle Rush Aura if active
    if (p.isAlive && p.isTackling) {
      ctx.save();
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#a855f7';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(0, -2, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Stunned spinning stars over head
    if (p.isAlive && p.stunTimer > 0) {
      const now = Date.now();
      const orbitSpeed = now / 140;
      const numStars = 3;
      const rx = 16;
      const ry = 6;
      const centerY = -30;

      for (let i = 0; i < numStars; i++) {
        const starAngle = orbitSpeed + (i * Math.PI * 2) / numStars;
        const sx = Math.cos(starAngle) * rx;
        const sy = centerY + Math.sin(starAngle) * ry;

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(now / 100 + i);

        // 4-point star path
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        const outerR = 5.5;
        const innerR = 2.0;
        for (let pIdx = 0; pIdx < 8; pIdx++) {
          const r = pIdx % 2 === 0 ? outerR : innerR;
          const a = (pIdx * Math.PI) / 4;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (pIdx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        // Inner white shine
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 1.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    }

    // Name Tag over head
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(p.config.name, 0, p.stunTimer > 0 ? -42 : -32);

    ctx.restore();
  }
}
