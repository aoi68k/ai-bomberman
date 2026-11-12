// Game Engine, State Machine, and Main Loop for AI-Bomberman

import {
  PLAYER_CONFIGS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PlayerConfig,
} from './constants';
import { GameMap } from './map';
import { BombManager, Bomb } from './bomb';
import { Player } from './player';
import { AIController } from './ai';
import { InputManager } from './input';
import { ParticleManager } from './particles';
import { GameRenderer } from './renderer';
import { sounds } from './audio';

export type GameState = 'START_SCREEN' | 'COUNTDOWN' | 'PLAYING' | 'ROUND_OVER' | 'PAUSED';

export interface GameStats {
  round: number;
  timeRemaining: number;
  scores: number[]; // wins per player id
  winner: Player | null;
  state: GameState;
  comCount: number;
}

export class GameManager {
  public canvas: HTMLCanvasElement;
  public renderer: GameRenderer;
  public input: InputManager;
  public map: GameMap;
  public bombManager: BombManager;
  public particles: ParticleManager;

  public players: Player[] = [];
  public aiControllers: AIController[] = [];

  public state: GameState = 'START_SCREEN';
  public comCount: number = 3; // Default: 1 Human vs 3 COM = 4 Players
  public round: number = 1;
  public roundTimeSeconds: number = 120; // 2 minutes
  public frameCount: number = 0;
  public countdownTimer: number = 180; // 3 seconds @ 60fps
  public roundOverTimer: number = 0;
  public scores: number[] = [0, 0, 0, 0];
  public roundWinner: Player | null = null;
  public isHurryUp: boolean = false;

  private isRunning: boolean = false;
  private animFrameId: number | null = null;

  public onStatsChange?: (stats: GameStats) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;

    this.renderer = new GameRenderer(canvas);
    this.input = new InputManager();
    this.map = new GameMap();
    this.bombManager = new BombManager();
    this.particles = new ParticleManager();

    this.setupPlayers();
  }

  public setupPlayers() {
    this.players = [];
    this.aiControllers = [];

    // Always create Player 1 (Human)
    const p1 = new Player(PLAYER_CONFIGS[0]);
    this.players.push(p1);

    // Create requested number of COM opponents (up to 3)
    for (let i = 1; i <= this.comCount; i++) {
      const com = new Player(PLAYER_CONFIGS[i]);
      this.players.push(com);
      this.aiControllers.push(new AIController(com));
    }
  }

  public setComCount(count: number) {
    this.comCount = Math.max(1, Math.min(3, count));
    this.setupPlayers();
    this.broadcastStats();
  }

  public startGame() {
    sounds.enableAudio();
    this.setupPlayers();
    this.scores = [0, 0, 0, 0];
    this.round = 1;
    this.startRound();
  }

  public startRound() {
    this.map.reset();
    this.bombManager.reset();
    this.particles.reset();
    this.isHurryUp = false;
    this.roundWinner = null;
    this.roundTimeSeconds = 120;
    this.frameCount = 0;
    this.countdownTimer = 180;
    this.state = 'COUNTDOWN';

    for (const p of this.players) {
      p.reset();
    }

    this.broadcastStats();
  }

  public togglePause() {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
    }
    this.broadcastStats();
  }

  public startLoop() {
    if (this.isRunning) return;
    this.isRunning = true;

    let lastTime = performance.now();
    const targetFpsInterval = 1000 / 60;

    const loop = (currentTime: number) => {
      this.animFrameId = requestAnimationFrame(loop);
      const elapsed = currentTime - lastTime;

      if (elapsed >= targetFpsInterval) {
        lastTime = currentTime - (elapsed % targetFpsInterval);
        this.update();
        this.render();
      }
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  public stopLoop() {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private update() {
    // Check input for Player 1
    const p1Input = this.input.getPlayerInput(0);
    if (p1Input.pause) {
      this.togglePause();
    }

    // In ROUND_OVER state, allow (A) button (p1Input.bomb), Start button, or [R]/Select (p1Input.restart) to proceed to next round
    if (this.state === 'ROUND_OVER') {
      if ((p1Input.bomb || p1Input.restart || p1Input.pause) && this.roundOverTimer > 30) {
        this.round++;
        this.startRound();
        return;
      }
    } else if (this.state === 'PAUSED') {
      if (p1Input.restart) {
        this.startRound();
        return;
      }
    }

    // STATE: COUNTDOWN
    if (this.state === 'COUNTDOWN') {
      this.countdownTimer--;
      if (this.countdownTimer <= 0) {
        this.state = 'PLAYING';
        sounds.playHurry();
        this.broadcastStats();
      }
      this.particles.update();
      this.input.endFrame();
      return;
    }

    // STATE: PAUSED or START_SCREEN
    if (this.state === 'PAUSED' || this.state === 'START_SCREEN') {
      this.input.endFrame();
      return;
    }

    // STATE: ROUND_OVER
    if (this.state === 'ROUND_OVER') {
      this.roundOverTimer++;
      this.bombManager.update(this.map, () => {});
      this.particles.update();
      this.input.endFrame();
      return;
    }

    // STATE: PLAYING
    this.frameCount++;
    if (this.frameCount % 60 === 0 && this.roundTimeSeconds > 0) {
      this.roundTimeSeconds--;
      if (this.roundTimeSeconds === 30 && !this.isHurryUp) {
        this.isHurryUp = true;
        sounds.playHurry();
      }
      this.broadcastStats();
    }

    // 1. Human (P1) input and movement
    const p1 = this.players[0];
    if (p1 && p1.isAlive) {
      p1.move(p1Input.dx, p1Input.dy, this.map, this.bombManager, (kickedBomb) => {
        sounds.playKick();
      });

      if (p1Input.bomb) {
        this.tryPlaceBomb(p1);
      }
    }

    // 2. COM Opponents AI update
    for (const ai of this.aiControllers) {
      ai.update(
        this.map,
        this.bombManager,
        this.players,
        (p) => this.tryPlaceBomb(p)
      );
    }

    // 3. Update Bombs and Explosions
    this.bombManager.update(
      this.map,
      (explodedBomb) => {
        sounds.playExplosion();
        this.particles.triggerShake(5, 12);
        this.particles.addExplosionParticles(explodedBomb.pixelX, explodedBomb.pixelY, 18);

        // Vibrate gamepad if Human (P1) is near explosion or owns bomb
        if (p1.isAlive) {
          const distToP1 = Math.hypot(p1.x - explodedBomb.pixelX, p1.y - explodedBomb.pixelY);
          if (distToP1 < 160 || explodedBomb.ownerId === 0) {
            this.input.vibrate(0, 240, 0.7, 0.4);
          }
        }

        // Return bomb ammo to owner
        const owner = this.players.find((p) => p.config.id === explodedBomb.ownerId);
        if (owner && owner.activeBombs > 0) {
          owner.activeBombs--;
        }
      },
      (blockTx, blockTy) => {
        // Soft block destroyed effect
        const px = blockTx * 48 + 24;
        const py = blockTy * 48 + 24;
        this.particles.addBlockDebris(px, py, 10);
      }
    );

    // 4. Check items pickup by players
    for (const p of this.players) {
      if (!p.isAlive) continue;
      const itemType = this.map.pickupItemAt(p.tileX, p.tileY);
      if (itemType) {
        p.applyItem(itemType);
        sounds.playItemGet();
        this.particles.addItemGetParticles(p.x, p.y);
      }
    }

    // 5. Check damage from explosions
    for (const p of this.players) {
      if (!p.isAlive) continue;

      if (this.bombManager.explosions.isCellDangerous(p.tileX, p.tileY)) {
        const isFatal = p.hit();
        if (isFatal) {
          sounds.playPlayerDeath();
          this.particles.triggerShake(8, 20);
          this.particles.addExplosionParticles(p.x, p.y, 24);

          if (p.config.id === 0) {
            // Strong vibration on player 1 defeat
            this.input.vibrate(0, 450, 1.0, 0.8);
          }
        } else {
          // Shield broke
          sounds.playShieldBreak();
          this.particles.addItemGetParticles(p.x, p.y, '#38bdf8');
          if (p.config.id === 0) {
            this.input.vibrate(0, 180, 0.5, 0.3);
          }
        }
      }
    }

    // 6. Update dying animation timers
    for (const p of this.players) {
      if (!p.isAlive && p.deathTimer > 0) {
        p.deathTimer--;
      }
    }

    // 7. Update Particles
    this.particles.update();

    // 8. Check Round Win / Draw Condition
    this.checkRoundOutcome();

    // End frame input cleanup
    this.input.endFrame();
  }

  private tryPlaceBomb(player: Player): boolean {
    if (!player.isAlive) return false;
    if (player.activeBombs >= player.maxBombs) return false;

    // Determine all players overlapping this tile right now
    const overlappingPlayers = this.players
      .filter((p) => p.isAlive && Math.hypot(p.x - (player.tileX * 48 + 24), p.y - (player.tileY * 48 + 24)) < 36)
      .map((p) => p.config.id);

    const bomb = this.bombManager.placeBomb(
      player.config.id,
      player.tileX,
      player.tileY,
      player.power,
      overlappingPlayers
    );

    if (bomb) {
      player.activeBombs++;
      sounds.playBombDrop();
      return true;
    }
    return false;
  }

  private checkRoundOutcome() {
    const alivePlayers = this.players.filter((p) => p.isAlive);

    // If 1 or 0 players remaining (or time ran out)
    if (alivePlayers.length <= 1 || this.roundTimeSeconds <= 0) {
      this.state = 'ROUND_OVER';
      this.roundOverTimer = 0;

      if (alivePlayers.length === 1) {
        this.roundWinner = alivePlayers[0];
        this.scores[this.roundWinner.config.id]++;
        sounds.playWin();
      } else {
        this.roundWinner = null; // Draw
      }

      this.broadcastStats();
    }
  }

  private broadcastStats() {
    if (this.onStatsChange) {
      this.onStatsChange({
        round: this.round,
        timeRemaining: this.roundTimeSeconds,
        scores: [...this.scores],
        winner: this.roundWinner,
        state: this.state,
        comCount: this.comCount,
      });
    }
  }

  private render() {
    this.renderer.render(
      this.map,
      this.bombManager,
      this.players,
      this.particles,
      this.roundTimeSeconds,
      this.round
    );

    // Overlay state messages
    const ctx = this.canvas.getContext('2d')!;

    if (this.state === 'COUNTDOWN') {
      const count = Math.ceil(this.countdownTimer / 60);
      const label = count > 0 ? `${count}` : 'BATTLE!';
      this.drawBigBanner(ctx, label, '#facc15');
    } else if (this.state === 'ROUND_OVER') {
      const bannerText = this.roundWinner ? `${this.roundWinner.config.name} WINS!` : 'DRAW GAME!';
      const bannerColor = this.roundWinner ? this.roundWinner.config.accentColor : '#94a3b8';
      this.drawBigBanner(ctx, bannerText, bannerColor, 'Press (A) / [R] for Next Round');
    } else if (this.state === 'PAUSED') {
      this.drawBigBanner(ctx, 'PAUSED', '#38bdf8', 'Press Start / [P] to Resume');
    }
  }

  private drawBigBanner(
    ctx: CanvasRenderingContext2D,
    mainText: string,
    accentColor: string,
    subText?: string
  ) {
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(0, CANVAS_HEIGHT / 2 - 55, CANVAS_WIDTH, 110);

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_HEIGHT / 2 - 55);
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2 - 55);
    ctx.moveTo(0, CANVAS_HEIGHT / 2 + 55);
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2 + 55);
    ctx.stroke();

    ctx.font = '900 36px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accentColor;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 10;
    ctx.fillText(mainText, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - (subText ? 14 : 0));

    if (subText) {
      ctx.font = 'bold 15px "Segoe UI", sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(subText, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 24);
    }

    ctx.restore();
  }
}
