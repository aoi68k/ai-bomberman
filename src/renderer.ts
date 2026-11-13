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

  // Offscreen caches to eliminate redundant per-frame drawing, gradients, and CSS filters
  private floorCache: HTMLCanvasElement | null = null;
  private cachedHasFloorImg: boolean = false;

  private gridCache: HTMLCanvasElement | null = null;
  private cachedGridVersion: number = -1;
  private cachedHasWallImg: boolean = false;
  private cachedHasSoftImg: boolean = false;

  private itemGlowCache: HTMLCanvasElement | null = null;
  private explosionCoreCache: HTMLCanvasElement | null = null;
  private flashingBombCache: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not get 2D rendering context');
    this.ctx = context;
  }

  public render(
    map: GameMap,
    bombManager: BombManager,
    players: Player[],
    particles: ParticleManager,
    timeRemaining: number, // in seconds
    round: number,
    overheadTagTimer: number = 0
  ) {
    const ctx = this.ctx;

    ctx.save();

    // Apply Screen Shake
    const shake = particles.getShakeOffset();
    if (shake.x !== 0 || shake.y !== 0) {
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.translate(shake.x, shake.y);
    }

    // 1. Draw Arena Floor (Single cached drawImage call)
    this.drawFloor(ctx);

    // 2. Draw Soft Blocks, Walls, and Items on the ground
    this.drawItems(ctx, map);
    this.drawGridTiles(ctx, map);

    // 3. Draw Bombs
    this.drawBombs(ctx, bombManager.bombs);

    // 4. Draw Explosions
    this.drawExplosions(ctx, bombManager.explosions.cells);

    // 5. Draw Players (Sort by Y position so characters in front render over characters behind)
    const sortedPlayers = [...players].sort((a, b) => a.y - b.y);
    for (const p of sortedPlayers) {
      this.drawPlayer(ctx, p, overheadTagTimer);
    }

    // 6. Draw Particles (on top of entities)
    particles.render(ctx);

    ctx.restore();
  }

  private drawFloor(ctx: CanvasRenderingContext2D) {
    const hasFloorImg = assets.hasImage('floor');
    if (!this.floorCache || this.cachedHasFloorImg !== hasFloorImg) {
      this.floorCache = document.createElement('canvas');
      this.floorCache.width = CANVAS_WIDTH;
      this.floorCache.height = CANVAS_HEIGHT;
      const fCtx = this.floorCache.getContext('2d')!;
      const floorImg = assets.getImage('floor');

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const px = x * TILE_SIZE;
          const py = y * TILE_SIZE;

          if (floorImg) {
            fCtx.drawImage(floorImg, px, py, TILE_SIZE, TILE_SIZE);
          } else {
            const isEven = (x + y) % 2 === 0;
            fCtx.fillStyle = isEven ? '#1e293b' : '#182234';
            fCtx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

            fCtx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
            fCtx.lineWidth = 1;
            fCtx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
          }
        }
      }
      this.cachedHasFloorImg = hasFloorImg;
    }

    ctx.drawImage(this.floorCache, 0, 0);
  }

  private drawGridTiles(ctx: CanvasRenderingContext2D, map: GameMap) {
    const hasWallImg = assets.hasImage('wall');
    const hasSoftImg = assets.hasImage('soft_block');

    if (
      !this.gridCache ||
      this.cachedGridVersion !== map.gridVersion ||
      this.cachedHasWallImg !== hasWallImg ||
      this.cachedHasSoftImg !== hasSoftImg
    ) {
      if (!this.gridCache) {
        this.gridCache = document.createElement('canvas');
        this.gridCache.width = CANVAS_WIDTH;
        this.gridCache.height = CANVAS_HEIGHT;
      }
      const gCtx = this.gridCache.getContext('2d')!;
      gCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const tile = map.getTile(x, y);
          const px = x * TILE_SIZE;
          const py = y * TILE_SIZE;

          if (tile === TILE.WALL) {
            this.drawIndestructibleWall(gCtx, px, py, x, y);
          } else if (tile === TILE.SOFT_BLOCK) {
            this.drawSoftBlock(gCtx, px, py);
          }
        }
      }
      this.cachedGridVersion = map.gridVersion;
      this.cachedHasWallImg = hasWallImg;
      this.cachedHasSoftImg = hasSoftImg;
    }

    ctx.drawImage(this.gridCache, 0, 0);
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

  private getItemGlowCanvas(): HTMLCanvasElement {
    if (!this.itemGlowCache) {
      const c = document.createElement('canvas');
      c.width = 40;
      c.height = 40;
      const gCtx = c.getContext('2d')!;
      const auraGrad = gCtx.createRadialGradient(20, 20, 4, 20, 20, 20);
      auraGrad.addColorStop(0, 'rgba(250, 204, 21, 0.45)');
      auraGrad.addColorStop(1, 'rgba(250, 204, 21, 0)');
      gCtx.fillStyle = auraGrad;
      gCtx.beginPath();
      gCtx.arc(20, 20, 20, 0, Math.PI * 2);
      gCtx.fill();
      this.itemGlowCache = c;
    }
    return this.itemGlowCache;
  }

  private drawItems(ctx: CanvasRenderingContext2D, map: GameMap) {
    if (map.activeItems.length === 0) return;
    const now = Date.now();
    const glowCanvas = this.getItemGlowCanvas();

    for (const item of map.activeItems) {
      const px = item.tileX * TILE_SIZE + TILE_SIZE / 2;
      const py = item.tileY * TILE_SIZE + TILE_SIZE / 2;

      // Floating bobbing animation
      const bob = Math.sin((now - item.spawnTime) / 220) * 3;

      ctx.save();
      ctx.translate(px, py + bob);

      // Glowing aura (cached sprite)
      ctx.drawImage(glowCanvas, -20, -20);

      // Render Item Image or fallback to emoji card
      const itemImg = assets.getImage(`item_${item.type}`);
      if (itemImg) {
        ctx.drawImage(itemImg, -18, -18, 36, 36);
      } else {
        if (item.type === ITEM.CHAIN_BOMB) {
          ctx.fillStyle = '#1c1917';
          ctx.strokeStyle = '#ffcf00';
        } else {
          ctx.fillStyle = '#0f172a';
          ctx.strokeStyle = '#facc15';
        }
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
          case ITEM.CHAIN_BOMB:
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText('⚡💣', 0, 1);
            break;
        }
      }

      ctx.restore();
    }
  }

  private getFlashingBombCanvas(bombImg: HTMLImageElement): HTMLCanvasElement {
    if (!this.flashingBombCache) {
      const c = document.createElement('canvas');
      c.width = TILE_SIZE;
      c.height = TILE_SIZE;
      const bCtx = c.getContext('2d')!;
      bCtx.drawImage(bombImg, 0, 0, TILE_SIZE, TILE_SIZE);
      bCtx.globalCompositeOperation = 'source-atop';
      bCtx.fillStyle = 'rgba(239, 68, 68, 0.55)';
      bCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      bCtx.globalCompositeOperation = 'source-over';
      this.flashingBombCache = c;
    }
    return this.flashingBombCache;
  }

  private drawBombs(ctx: CanvasRenderingContext2D, bombs: Bomb[]) {
    if (bombs.length === 0) return;
    const bombImg = assets.getImage('bomb');
    const now = Date.now();

    for (const bomb of bombs) {
      const px = bomb.pixelX;
      const py = bomb.pixelY;

      // Pulse rate accelerates as timer nears 0
      const pulseSpeed = bomb.timer < 45 ? 0.35 : 0.18;
      const pulseScale = 1.0 + Math.sin(bomb.timer * pulseSpeed) * (bomb.timer < 45 ? 0.15 : 0.08);

      ctx.save();
      ctx.translate(px, py);
      ctx.scale(pulseScale, pulseScale);

      // Mega Bomb / Nova Bomb fiery golden-red aura (no shadowBlur)
      if ((bomb as any).isMega) {
        const megaPulse = 0.7 + 0.3 * Math.sin(now / 90);
        ctx.save();
        ctx.strokeStyle = `rgba(239, 68, 68, ${0.38 * megaPulse})`;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Floor shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 14, 15, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      const isFlashing = bomb.timer < 35 && Math.floor(bomb.timer / 4) % 2 === 0;

      if (bombImg) {
        const sprite = isFlashing ? this.getFlashingBombCanvas(bombImg) : bombImg;
        ctx.drawImage(sprite, -TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
        ctx.restore();
        continue;
      }

      // Bomb body (fast concentric circles instead of per-frame createRadialGradient)
      ctx.fillStyle = isFlashing ? '#7f1d1d' : '#020617';
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = isFlashing ? '#ef4444' : '#1e293b';
      ctx.beginPath();
      ctx.arc(-1.5, -1.5, 13, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = isFlashing ? '#fca5a5' : '#64748b';
      ctx.beginPath();
      ctx.arc(-5, -6, 4.5, 0, Math.PI * 2);
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

  private getExplosionCoreCanvas(): HTMLCanvasElement {
    if (!this.explosionCoreCache) {
      const c = document.createElement('canvas');
      c.width = TILE_SIZE;
      c.height = TILE_SIZE;
      const eCtx = c.getContext('2d')!;
      const half = TILE_SIZE / 2;
      const grad = eCtx.createRadialGradient(half, half, 4, half, half, TILE_SIZE * 0.52);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, '#fbbf24');
      grad.addColorStop(0.7, '#f97316');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      eCtx.fillStyle = grad;
      eCtx.beginPath();
      eCtx.arc(half, half, TILE_SIZE * 0.52, 0, Math.PI * 2);
      eCtx.fill();
      this.explosionCoreCache = c;
    }
    return this.explosionCoreCache;
  }

  private drawExplosions(ctx: CanvasRenderingContext2D, cells: Array<{ tileX: number; tileY: number; life: number; maxLife: number; direction: string }>) {
    if (cells.length === 0) return;
    const coreCanvas = this.getExplosionCoreCanvas();

    for (const cell of cells) {
      const px = cell.tileX * TILE_SIZE;
      const py = cell.tileY * TILE_SIZE;
      const progress = cell.life / cell.maxLife; // 1 -> 0
      const alpha = Math.min(1.0, progress * 1.4);

      ctx.save();
      ctx.globalAlpha = alpha;

      const cx = px + TILE_SIZE / 2;
      const cy = py + TILE_SIZE / 2;

      // Outer orange flame (cached radial gradient sprite)
      ctx.drawImage(coreCanvas, px, py);

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

  private drawPlayer(ctx: CanvasRenderingContext2D, p: Player, overheadTagTimer: number = 0) {
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

    // Shield Aura if active (no shadowBlur)
    if (p.shield > 0) {
      const shieldPulse = Math.sin(Date.now() / 150) * 2;
      const r = 22 + shieldPulse;
      ctx.strokeStyle = 'rgba(2, 132, 199, 0.35)';
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.arc(0, -2, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, -2, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Mega Bomb Armed Aura if active (no shadowBlur)
    if (p.isAlive && p.hasMegaBomb) {
      const megaPulse = Math.sin(Date.now() / 110) * 2.5;
      const r = 24 + megaPulse;
      ctx.save();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.arc(0, -2, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(0, -2, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Tackle / Slash Rush Aura if active (no shadowBlur)
    if (p.isAlive && (p.isTackling || p.slashSequenceTimer > 0)) {
      const isSlash = p.tackleSlashMode !== 'none' || p.slashSequenceTimer > 0;
      ctx.save();
      ctx.strokeStyle = isSlash ? 'rgba(2, 132, 199, 0.4)' : 'rgba(168, 85, 247, 0.4)';
      ctx.lineWidth = p.tackleSlashMode === 'ultra_tempest' ? 9 : 7;
      ctx.beginPath();
      ctx.arc(0, -2, 22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = isSlash ? '#38bdf8' : '#c084fc';
      ctx.lineWidth = p.tackleSlashMode === 'ultra_tempest' ? 3.5 : 2.5;
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

    // Cooldown / Charge Fireflies orbiting around the player:
    // Yellow = Skill, Red = Ultra skill
    // Dim & gradually brightening while charging (0%..99%), distinctly glowing with aura & trail when 100% ready
    if (p.isAlive) {
      const now = Date.now();
      const baseAngle = now / 520 + p.config.id * 1.7;

      const skillProgress =
        p.skillCooldownTimer <= 0
          ? 1
          : Math.max(0, Math.min(0.999, 1 - p.skillCooldownTimer / Math.max(1, p.config.skillCooldown)));
      this.drawFirefly(ctx, baseAngle, now, '#facc15', '#785e10', '#ffffff', 0, skillProgress);

      const ultraProgress = Math.max(0, Math.min(1, p.ultraGauge / 10));
      this.drawFirefly(ctx, baseAngle + Math.PI, now, '#ef4444', '#7f1d1d', '#ffffff', 1.9, ultraProgress);
    }

    // Overhead player tag (1P / COM / 2P...) shown for 6 seconds from countdown start in slot color
    if (overheadTagTimer > 0 && p.isAlive) {
      const alpha = overheadTagTimer < 30 ? overheadTagTimer / 30 : 1;
      const tagY = p.stunTimer > 0 ? -42 : -32;
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.font = '900 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)';
      ctx.strokeText(p.config.nameTag, 0, tagY);
      ctx.fillStyle = p.config.accentColor;
      ctx.fillText(p.config.nameTag, 0, tagY);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawFirefly(
    ctx: CanvasRenderingContext2D,
    angle: number,
    now: number,
    readyColor: string,
    dimColor: string,
    coreColor: string,
    phaseOffset: number,
    progress: number
  ) {
    const rx = 22;
    const ry = 13;
    const baseY = -6;
    const isReady = progress >= 1;

    const getPos = (a: number, t: number) => ({
      x: Math.cos(a) * rx,
      y: baseY + Math.sin(a) * ry + Math.sin(t * 2.2 + phaseOffset) * 3.5,
    });

    const pos = getPos(angle, now / 520);

    if (!isReady) {
      // Charging / Cooldown state (0%..99%): dim dot without glow or trail, gradually brightening with progress
      const alpha = 0.2 + 0.45 * progress;
      const radius = 1.6 + 0.8 * progress;
      ctx.save();
      // Subtle dim body
      ctx.globalAlpha = alpha;
      ctx.fillStyle = dimColor;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius + 0.5, 0, Math.PI * 2);
      ctx.fill();

      // Gradually brightening inner tint as progress approaches 100%
      ctx.globalAlpha = 0.1 + 0.4 * progress;
      ctx.fillStyle = readyColor;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // 100% Ready state: bright glowing firefly with trail, aura, and white-hot core (no shadowBlur)
    const pulse = 0.78 + 0.22 * Math.sin(now / 170 + phaseOffset);

    // Trailing particles behind the ready firefly
    for (let i = 2; i >= 1; i--) {
      const trailPos = getPos(angle - i * 0.22, now / 520 - i * 0.22);
      ctx.save();
      ctx.globalAlpha = (0.4 - i * 0.12) * pulse;
      ctx.fillStyle = readyColor;
      ctx.beginPath();
      ctx.arc(trailPos.x, trailPos.y, 2.6 - i * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    // Outer soft halo
    ctx.globalAlpha = 0.22 * pulse;
    ctx.fillStyle = readyColor;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 8.2, 0, Math.PI * 2);
    ctx.fill();

    // Mid soft glow
    ctx.globalAlpha = 0.48 * pulse;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 5.4, 0, Math.PI * 2);
    ctx.fill();

    // Bright firefly body
    ctx.globalAlpha = 0.98;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Inner white-hot core (clearly distinguishes 100% ready from 99%)
    ctx.globalAlpha = 1;
    ctx.fillStyle = coreColor;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
