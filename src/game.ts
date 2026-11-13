// Game Engine, State Machine, and Main Loop for AI-Bomberman

import {
  PLAYER_CONFIGS,
  PLAYER_SLOT_COLORS,
  CHARACTERS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PlayerConfig,
} from './constants';
import { GameMap } from './map';
import { BombManager, Bomb } from './bomb';
import { Player } from './player';
import { AIController } from './ai';
import { InputManager, MenuInput } from './input';
import { ParticleManager } from './particles';
import { GameRenderer } from './renderer';
import { sounds } from './audio';
import { GameSnapshot, RemoteInputPayload, SoundEventName } from './network';

export type GameState = 'TITLE' | 'SETUP' | 'COUNTDOWN' | 'PLAYING' | 'ROUND_OVER' | 'PAUSED';

export interface PlayerSlotConfig {
  slotIndex: number; // 0..3
  control: '1P' | 'COM' | 'OFF' | 'REMOTE';
  charId: string;
}

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

  public state: GameState = 'TITLE';
  public selectedCharId: string = 'bomber_blue';
  public comCount: number = 3;
  public playerSlots: PlayerSlotConfig[] = [];
  public round: number = 1;
  public roundTimeSeconds: number = 120; // 2 minutes
  public frameCount: number = 0;
  public countdownTimer: number = 180; // 3 seconds @ 60fps
  private overheadTagTimer: number = 0; // 6 seconds @ 60fps (countdown 3s + playing 3s)
  public roundOverTimer: number = 0;
  public scores: number[] = [0, 0, 0, 0];
  public roundWinner: Player | null = null;
  public isHurryUp: boolean = false;

  // Sudden Death (Falling Walls) after 45s
  public suddenDeathIndex: number = 0;
  public suddenDeathTimer: number = 0;
  public suddenDeathPath: Array<{ x: number; y: number }> = [];

  // Yangyang's ranged wind slashes and 3x3 tempest zones
  public activeWindSlashes: Array<{
    ownerId: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
    remainingDist: number;
    speed: number;
    tick: number;
    hitEnemies: Set<number>;
  }> = [];

  public activeTempestZones: Array<{
    ownerId: number;
    centerTx: number;
    centerTy: number;
    remainingFrames: number;
  }> = [];

  private isRunning: boolean = false;
  private animFrameId: number | null = null;

  // Online Multiplayer State
  public isOnlineHost: boolean = false;
  public isOnlineGuest: boolean = false;
  public remoteInputs: Map<number, RemoteInputPayload> = new Map();
  private lastGuestInputSent: RemoteInputPayload = { dx: 0, dy: 0, bomb: false, skill: false, ultra: false };
  private syncTickCounter: number = 0;

  public onStatsChange?: (stats: GameStats) => void;
  public onMenuInput?: (input: MenuInput) => void;
  public onHostSnapshot?: (snapshot: GameSnapshot) => void;
  public onHostSound?: (event: SoundEventName) => void;
  public onGuestSendInput?: (input: RemoteInputPayload) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;

    this.renderer = new GameRenderer(canvas);
    this.input = new InputManager();
    this.map = new GameMap();
    this.bombManager = new BombManager();
    this.particles = new ParticleManager();

    const charKeys = Object.keys(CHARACTERS);
    const fallbackId = charKeys[0] || 'bomber_blue';
    this.playerSlots = [0, 1, 2, 3].map((idx) => ({
      slotIndex: idx,
      control: idx === 0 ? '1P' : 'COM',
      charId: charKeys[idx % Math.max(1, charKeys.length)] || fallbackId,
    }));

    this.setupPlayers();
  }

  public setupPlayers() {
    this.players = [];
    this.aiControllers = [];

    const fallbackChar = Object.values(CHARACTERS)[0];

    for (const slot of this.playerSlots) {
      if (slot.control === 'OFF') continue;

      const charData = CHARACTERS[slot.charId] || fallbackChar;
      const baseConfig = PLAYER_CONFIGS[slot.slotIndex];
      const isHuman = slot.control === '1P' || slot.control === 'REMOTE';

      const slotColor = PLAYER_SLOT_COLORS[slot.slotIndex] || charData.accentColor;
      const labelPrefix = slot.control === '1P' ? '1P' : slot.control === 'REMOTE' ? `${slot.slotIndex + 1}P` : `COM ${slot.slotIndex + 1}`;
      const tag = slot.control === 'REMOTE' ? `${slot.slotIndex + 1}P` : slot.control;

      const config: PlayerConfig = {
        ...baseConfig,
        id: slot.slotIndex,
        isHuman,
        charId: charData.charId,
        name: `${labelPrefix} (${charData.jpName})`,
        nameTag: tag,
        color: charData.color,
        subColor: charData.subColor,
        accentColor: slotColor,
        stats: charData.stats,
        skillType: charData.skillType,
        skillCooldown: charData.skillCooldown,
        ultraType: charData.ultraType,
        ultraCooldown: charData.ultraCooldown,
      };

      const player = new Player(config);
      this.players.push(player);
      if (!isHuman) {
        this.aiControllers.push(new AIController(player));
      }
    }

    this.comCount = this.players.filter((p) => !p.config.isHuman).length;
  }

  public setPlayerSlots(slots: PlayerSlotConfig[]) {
    this.playerSlots = slots.map((s) => ({ ...s }));
    this.setupPlayers();
    this.broadcastStats();
  }

  public showTitle() {
    this.state = 'TITLE';
    this.broadcastStats();
  }

  public showSetup() {
    this.state = 'SETUP';
    this.broadcastStats();
  }

  public selectCharacter(charId: string) {
    if (CHARACTERS[charId]) {
      this.selectedCharId = charId;
      if (this.playerSlots[0]) {
        this.playerSlots[0].charId = charId;
      }
      this.setupPlayers();
      this.broadcastStats();
    }
  }

  public setComCount(count: number) {
    this.comCount = Math.max(1, Math.min(3, count));
    for (let i = 1; i <= 3; i++) {
      if (this.playerSlots[i]) {
        this.playerSlots[i].control = i <= this.comCount ? 'COM' : 'OFF';
      }
    }
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
    this.overheadTagTimer = 360;
    this.state = 'COUNTDOWN';

    this.suddenDeathIndex = 0;
    this.suddenDeathTimer = 0;
    this.suddenDeathPath = this.generateSpiralPath();
    this.activeWindSlashes = [];
    this.activeTempestZones = [];

    for (const p of this.players) {
      p.reset();
    }

    this.broadcastStats();
  }

  /**
   * Generates inward spiral coordinates from inner ring (x: 1..13, y: 1..11)
   */
  private generateSpiralPath(): Array<{ x: number; y: number }> {
    const path: Array<{ x: number; y: number }> = [];
    let top = 1;
    let bottom = 11;
    let left = 1;
    let right = 13;

    while (top <= bottom && left <= right) {
      // Top row (left to right)
      for (let x = left; x <= right; x++) path.push({ x, y: top });
      top++;

      // Right col (top to bottom)
      for (let y = top; y <= bottom; y++) path.push({ x: right, y });
      right--;

      if (top <= bottom) {
        // Bottom row (right to left)
        for (let x = right; x >= left; x--) path.push({ x, y: bottom });
        bottom--;
      }

      if (left <= right) {
        // Left col (bottom to top)
        for (let y = bottom; y >= top; y--) path.push({ x: left, y });
        left++;
      }
    }
    return path;
  }

  public togglePause() {
    // ポーズは1P（ホスト / ローカル1P）のみ可能
    if (this.isOnlineGuest) return;
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
    }
    this.broadcastStats();
    if (this.isOnlineHost) {
      this.onHostSnapshot?.(this.exportSnapshot());
    }
  }

  public setRemoteInput(slotIndex: number, input: RemoteInputPayload) {
    const prev = this.remoteInputs.get(slotIndex);
    this.remoteInputs.set(slotIndex, {
      dx: input.dx,
      dy: input.dy,
      bomb: Boolean(prev?.bomb || input.bomb),
      skill: Boolean(prev?.skill || input.skill),
      ultra: Boolean(prev?.ultra || input.ultra),
    });
  }

  private emitSound(event: SoundEventName) {
    if (this.isOnlineHost) {
      this.onHostSound?.(event);
    }
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
    // STATE: TITLE, SETUP, or PAUSED (poll gamepad menu navigation)
    if (this.state === 'TITLE' || this.state === 'SETUP' || this.state === 'PAUSED') {
      const menuInput = this.input.getMenuInput();
      if (this.onMenuInput && !this.isOnlineGuest) {
        this.onMenuInput(menuInput);
      } else if (this.onMenuInput && this.state === 'SETUP') {
        this.onMenuInput(menuInput);
      }
      this.input.endFrame();
      return;
    }

    // Online Guest: only send local input to Host and animate particles
    if (this.isOnlineGuest) {
      const guestInput = this.input.getPlayerInput(0);
      if (this.state === 'PLAYING' || this.state === 'COUNTDOWN') {
        const payload: RemoteInputPayload = {
          dx: guestInput.dx,
          dy: guestInput.dy,
          bomb: guestInput.bomb,
          skill: guestInput.skill,
          ultra: guestInput.ultra,
        };
        const changed =
          payload.dx !== this.lastGuestInputSent.dx ||
          payload.dy !== this.lastGuestInputSent.dy ||
          payload.bomb ||
          payload.skill ||
          payload.ultra;
        this.syncTickCounter++;
        if (changed || this.syncTickCounter % 2 === 0) {
          this.onGuestSendInput?.(payload);
          this.lastGuestInputSent = { ...payload, bomb: false, skill: false, ultra: false };
        }
      }
      this.particles.update();
      this.input.endFrame();
      return;
    }

    // Check input for Player 1 (1P / Host)
    const p1Input = this.input.getPlayerInput(0);
    if (p1Input.pause) {
      this.togglePause();
    }

    // In ROUND_OVER state, allow (A) button (p1Input.bomb), Start button, or [R]/Select (p1Input.restart) to proceed to next round
    if (this.state === 'ROUND_OVER') {
      if ((p1Input.bomb || p1Input.restart || p1Input.pause) && this.roundOverTimer > 30) {
        this.round++;
        this.startRound();
        if (this.isOnlineHost) {
          this.onHostSnapshot?.(this.exportSnapshot());
        }
        return;
      }
    }

    // STATE: COUNTDOWN
    if (this.state === 'COUNTDOWN') {
      this.countdownTimer--;
      if (this.overheadTagTimer > 0) this.overheadTagTimer--;
      if (this.countdownTimer <= 0) {
        this.state = 'PLAYING';
        sounds.playHurry();
        this.emitSound('hurry');
        this.broadcastStats();
      }
      this.particles.update();
      this.input.endFrame();
      if (this.isOnlineHost) {
        this.syncTickCounter++;
        if (this.syncTickCounter % 2 === 0 || this.state === 'PLAYING') {
          this.onHostSnapshot?.(this.exportSnapshot());
        }
      }
      return;
    }

    // STATE: ROUND_OVER
    if (this.state === 'ROUND_OVER') {
      this.roundOverTimer++;
      this.bombManager.update(this.map, () => {});
      this.particles.update();
      this.input.endFrame();
      if (this.isOnlineHost) {
        this.syncTickCounter++;
        if (this.syncTickCounter % 3 === 0) {
          this.onHostSnapshot?.(this.exportSnapshot());
        }
      }
      return;
    }

    // STATE: PLAYING
    this.frameCount++;
    if (this.overheadTagTimer > 0) this.overheadTagTimer--;
    if (this.frameCount % 60 === 0 && this.roundTimeSeconds > 0) {
      this.roundTimeSeconds--;
      if (this.roundTimeSeconds === 45 && !this.isHurryUp) {
        this.isHurryUp = true;
        sounds.playHurry();
        this.emitSound('hurry');
      }
      this.broadcastStats();
    }

    // Sudden death: Drop indestructible walls from outside inward when time <= 45 seconds
    if (this.roundTimeSeconds <= 45) {
      this.suddenDeathTimer++;
      // Every 22 frames (~0.36s), drop the next wall along the inward spiral
      if (this.suddenDeathTimer >= 22) {
        this.suddenDeathTimer = 0;
        this.dropNextSuddenDeathWall();
      }
    }

    // Update active tackles and slash sequences (Bomber Purple & Chen)
    for (const p of this.players) {
      if (!p.isAlive) continue;
      if (p.slashSequenceTimer > 0) {
        this.updateChenSlashSequence(p);
      } else if (p.isTackling) {
        this.updatePlayerTackle(p);
      }
    }

    // Update Yangyang's wind slashes and 3x3 tempest zones
    this.updateWindSlashes();
    this.updateTempestZones();

    // 1. Human players (1P + any Online Remote Guests) input, movement, skill, and ultra
    const p1 = this.players.find((p) => p.config.id === 0 && p.config.isHuman);
    for (const hp of this.players) {
      if (!hp.config.isHuman || !hp.isAlive) continue;

      let hInput: RemoteInputPayload;
      if (hp.config.id === 0) {
        hInput = p1Input;
      } else {
        const remote = this.remoteInputs.get(hp.config.id);
        if (!remote) continue;
        hInput = { ...remote };
        // Consume one-shot button presses
        remote.bomb = false;
        remote.skill = false;
        remote.ultra = false;
      }

      if (!hp.isTackling && hp.slashSequenceTimer <= 0) {
        hp.move(hInput.dx, hInput.dy, this.map, this.bombManager, () => {
          sounds.playKick();
          this.emitSound('kick');
        });

        if (hInput.bomb) {
          this.tryPlaceBomb(hp);
        }

        if (hInput.skill) {
          if (this.tryUseSkill(hp) && hp.isTackling) {
            this.updatePlayerTackle(hp);
          }
        }
        if (hInput.ultra) {
          if (this.tryUseUltra(hp) && hp.isTackling) {
            this.updatePlayerTackle(hp);
          }
        }
      }
    }

    // Decrement cooldowns for all players
    for (const p of this.players) {
      if (p.skillCooldownTimer > 0) {
        p.skillCooldownTimer--;
      }
      if (p.ultraCooldownTimer > 0) {
        p.ultraCooldownTimer--;
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
        this.emitSound('explosion');
        this.particles.triggerShake(5, 12);
        this.particles.addExplosionParticles(explodedBomb.pixelX, explodedBomb.pixelY, 18);

        // Vibrate gamepad if Human (1P) is near explosion or owns bomb
        if (p1 && p1.isAlive) {
          const distToP1 = Math.hypot(p1.x - explodedBomb.pixelX, p1.y - explodedBomb.pixelY);
          if (distToP1 < 160 || explodedBomb.ownerId === p1.config.id) {
            this.input.vibrate(0, 240, 0.7, 0.4);
          }
        }

        // Return bomb ammo to owner
        const owner = this.players.find((p) => p.config.id === explodedBomb.ownerId);
        if (owner && owner.activeBombs > 0) {
          owner.activeBombs--;
        }

        if (this.isOnlineHost) {
          this.onHostSnapshot?.(this.exportSnapshot());
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
        this.emitSound('pickup');
        this.particles.addItemGetParticles(p.x, p.y);
        if (this.isOnlineHost) {
          this.onHostSnapshot?.(this.exportSnapshot());
        }
      }
    }

    // 5. Check damage from explosions
    for (const p of this.players) {
      if (!p.isAlive) continue;

      if (this.bombManager.explosions.isCellDangerous(p.tileX, p.tileY)) {
        const isFatal = p.hit();
        if (isFatal) {
          sounds.playPlayerDeath();
          this.emitSound('death');
          this.particles.triggerShake(8, 20);
          this.particles.addExplosionParticles(p.x, p.y, 24);

          if (p.config.id === 0) {
            // Strong vibration on player 1 defeat
            this.input.vibrate(0, 450, 1.0, 0.8);
          }
          if (this.isOnlineHost) {
            this.onHostSnapshot?.(this.exportSnapshot());
          }
        } else {
          // Shield broke
          sounds.playShieldBreak();
          this.emitSound('shieldBreak');
          this.particles.addItemGetParticles(p.x, p.y, '#38bdf8');
          if (p.config.id === 0) {
            this.input.vibrate(0, 180, 0.5, 0.3);
          }
          if (this.isOnlineHost) {
            this.onHostSnapshot?.(this.exportSnapshot());
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

    // Online Host: Broadcast battle state to all connected guests
    if (this.isOnlineHost) {
      this.syncTickCounter++;
      if (this.syncTickCounter % 2 === 0 || this.state === 'ROUND_OVER') {
        this.onHostSnapshot?.(this.exportSnapshot());
      }
    }
  }

  private tryPlaceBomb(player: Player): boolean {
    if (!player.isAlive || player.stunTimer > 0 || player.isTackling || player.slashSequenceTimer > 0) return false;
    if (player.activeBombs >= player.maxBombs) return false;

    // Determine all players overlapping this tile right now
    const overlappingPlayers = this.players
      .filter((p) => p.isAlive && Math.hypot(p.x - (player.tileX * 48 + 24), p.y - (player.tileY * 48 + 24)) < 36)
      .map((p) => p.config.id);

    // Apply Mega Bomb power boost if active
    let power = player.power;
    if (player.hasMegaBomb) {
      power = Math.min(8, player.power + 4);
      player.hasMegaBomb = false;
      this.particles.triggerShake(4, 8);
    }

    const bomb = this.bombManager.placeBomb(
      player.config.id,
      player.tileX,
      player.tileY,
      power,
      overlappingPlayers
    );

    if (bomb) {
      player.activeBombs++;
      player.lastPlacedBombId = bomb.id;
      if (player.ultraGauge < 10) {
        player.ultraGauge = Math.min(10, player.ultraGauge + 1);
      }
      sounds.playBombDrop();
      if (this.isOnlineHost) {
        this.emitSound('placeBomb');
        this.onHostSnapshot?.(this.exportSnapshot());
      }
      this.broadcastStats();
      return true;
    }
    return false;
  }

  /**
   * Executes unique character skill
   */
  public tryUseSkill(player: Player): boolean {
    if (!player.isAlive || player.stunTimer > 0 || player.isTackling || player.slashSequenceTimer > 0) return false;
    if (player.skillCooldownTimer > 0) return false;

    const skillType = player.config.skillType;

    switch (skillType) {
      case 'DASH': {
        // Dash 2 tiles in current facing direction if not blocked
        const dirs = {
          up: { dx: 0, dy: -2 },
          down: { dx: 0, dy: 2 },
          left: { dx: -2, dy: 0 },
          right: { dx: 2, dy: 0 },
        };
        const { dx, dy } = dirs[player.facing];
        const targetTx = Math.max(1, Math.min(13, player.tileX + dx));
        const targetTy = Math.max(1, Math.min(11, player.tileY + dy));

        if (this.map.isWalkable(targetTx, targetTy) && !this.bombManager.getBombAt(targetTx, targetTy)) {
          this.particles.addItemGetParticles(player.x, player.y, player.config.color);
          player.x = targetTx * 48 + 24;
          player.y = targetTy * 48 + 24;
          player.skillCooldownTimer = player.config.skillCooldown;
          sounds.playKick();
          this.particles.addItemGetParticles(player.x, player.y, '#ffffff');
          if (player.config.id === 0) this.input.vibrate(0, 100, 0.4, 0.2);
          return true;
        }
        return false;
      }

      case 'TACKLE': {
        // Tackle forward up to 2 tiles at readable rush speed, stunning any opponent hit along the path for 3 seconds (180 frames)
        const dirs = {
          up: { dx: 0, dy: -1 },
          down: { dx: 0, dy: 1 },
          left: { dx: -1, dy: 0 },
          right: { dx: 1, dy: 0 },
        };
        const { dx, dy } = dirs[player.facing];

        // Check if cannot even move forward (facing wall or solid bomb right at hitbox)
        if (player.isColliding(player.x + dx * 16, player.y + dy * 16, this.map, this.bombManager)) {
          return false;
        }

        // Start tackle charge: 2 tiles (96px) at speed 5.0 px/frame (~19 frames = ~0.32s)
        player.startTackle(dx, dy, 2 * 48, 5.0);
        player.skillCooldownTimer = player.config.skillCooldown;
        sounds.playKick();
        this.particles.addItemGetParticles(player.x, player.y, '#c084fc');
        if (player.config.id === 0) {
          this.input.vibrate(0, 120, 0.5, 0.2);
        }
        return true;
      }

      case 'REMOTE_DETONATE': {
        // Detonate the last placed bomb belonging to this player immediately
        const targetBomb = this.bombManager.bombs.find((b) => b.ownerId === player.config.id);
        if (targetBomb) {
          targetBomb.timer = 1; // Detonate next tick
          player.skillCooldownTimer = player.config.skillCooldown;
          sounds.playHurry();
          this.particles.addItemGetParticles(targetBomb.pixelX, targetBomb.pixelY, '#ef4444');
          if (player.config.id === 0) this.input.vibrate(0, 150, 0.6, 0.3);
          return true;
        }
        return false;
      }

      case 'MEGA_BOMB': {
        // Empower next bomb
        player.hasMegaBomb = true;
        player.skillCooldownTimer = player.config.skillCooldown;
        sounds.playHurry();
        this.particles.addItemGetParticles(player.x, player.y, '#f59e0b');
        if (player.config.id === 0) this.input.vibrate(0, 150, 0.5, 0.3);
        return true;
      }

      case 'SHIELD_DEPLOY': {
        // Deploy emergency shield
        player.shield = Math.min(player.shield + 1, 2);
        player.skillCooldownTimer = player.config.skillCooldown;
        sounds.playShieldBreak();
        this.particles.addItemGetParticles(player.x, player.y, '#38bdf8');
        if (player.config.id === 0) this.input.vibrate(0, 150, 0.5, 0.3);
        return true;
      }

      case 'CHEN_SLASH_RUSH': {
        // Phase 1: 2 slashes across 0..1 tiles forward, then Phase 2: rush forward up to 2 tiles while slashing
        const dirs = {
          up: { dx: 0, dy: -1 },
          down: { dx: 0, dy: 1 },
          left: { dx: -1, dy: 0 },
          right: { dx: 1, dy: 0 },
        };
        const { dx, dy } = dirs[player.facing];
        player.slashSequenceTimer = 18;
        player.slashSeqDx = dx;
        player.slashSeqDy = dy;
        player.skillCooldownTimer = player.config.skillCooldown;

        // 1st slash immediately (0..1 tiles forward)
        this.performSlashHit(player, dx, dy, false);
        if (player.config.id === 0) {
          this.input.vibrate(0, 100, 0.5, 0.25);
        }
        return true;
      }

      case 'YANGYANG_WIND_SLASH': {
        // Send a flurry of wind slashes 2 tiles forward; hits stun for 2 seconds (120 frames)
        const dirs = {
          up: { dx: 0, dy: -1 },
          down: { dx: 0, dy: 1 },
          left: { dx: -1, dy: 0 },
          right: { dx: 1, dy: 0 },
        };
        const { dx, dy } = dirs[player.facing];
        player.skillCooldownTimer = player.config.skillCooldown;
        this.activeWindSlashes.push({
          ownerId: player.config.id,
          x: player.x + dx * 16,
          y: player.y + dy * 16,
          dx,
          dy,
          remainingDist: 2 * 48,
          speed: 8.0,
          tick: 0,
          hitEnemies: new Set(),
        });
        sounds.playKick();
        this.particles.addItemGetParticles(player.x, player.y, '#2dd4bf');
        if (player.config.id === 0) {
          this.input.vibrate(0, 120, 0.5, 0.25);
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Executes Ultra Skill
   */
  public tryUseUltra(player: Player): boolean {
    if (!player.isAlive || player.stunTimer > 0 || player.isTackling || player.slashSequenceTimer > 0) return false;
    if (player.ultraGauge < 10) return false;

    const ultraType = player.config.ultraType;
    const dirs = {
      up: { dx: 0, dy: -1 },
      down: { dx: 0, dy: 1 },
      left: { dx: -1, dy: 0 },
      right: { dx: 1, dy: 0 },
    };
    const { dx, dy } = dirs[player.facing];

    switch (ultraType) {
      case 'CHEN_TEMPEST_RUSH': {
        // Flurry of slashes while rushing forward 4 tiles (192px)
        player.ultraGauge = 0;
        player.startTackle(dx, dy, 4 * 48, 6.0, false, 'ultra_tempest');
        this.performSlashHit(player, dx, dy, false, true);
        this.particles.triggerShake(5, 16);
        if (player.config.id === 0) {
          this.input.vibrate(0, 260, 0.8, 0.5);
        }
        this.broadcastStats();
        return true;
      }

      case 'ULTRA_BLITZ_DASH': {
        const targetTx = Math.max(1, Math.min(13, player.tileX + dx * 3));
        const targetTy = Math.max(1, Math.min(11, player.tileY + dy * 3));
        if (this.map.isWalkable(targetTx, targetTy) && !this.bombManager.getBombAt(targetTx, targetTy)) {
          this.particles.addItemGetParticles(player.x, player.y, '#38bdf8');
          player.x = targetTx * 48 + 24;
          player.y = targetTy * 48 + 24;
          player.invulnerableTimer = Math.max(player.invulnerableTimer, 60);
          player.ultraGauge = 0;
          sounds.playKick();
          this.particles.addItemGetParticles(player.x, player.y, '#ffffff');
          if (player.config.id === 0) this.input.vibrate(0, 150, 0.6, 0.3);
          this.broadcastStats();
          return true;
        }
        return false;
      }

      case 'ULTRA_ALL_DETONATE': {
        const myBombs = this.bombManager.bombs.filter((b) => b.ownerId === player.config.id);
        if (myBombs.length > 0) {
          for (const b of myBombs) {
            b.timer = 1;
            this.particles.addItemGetParticles(b.pixelX, b.pixelY, '#ef4444');
          }
          player.ultraGauge = 0;
          sounds.playHurry();
          if (player.config.id === 0) this.input.vibrate(0, 200, 0.7, 0.4);
          this.broadcastStats();
          return true;
        }
        return false;
      }

      case 'ULTRA_NOVA_BOMB': {
        if (player.activeBombs >= player.maxBombs) return false;
        const overlappingPlayers = this.players
          .filter((p) => p.isAlive && Math.hypot(p.x - (player.tileX * 48 + 24), p.y - (player.tileY * 48 + 24)) < 36)
          .map((p) => p.config.id);
        const bomb = this.bombManager.placeBomb(player.config.id, player.tileX, player.tileY, 8, overlappingPlayers);
        if (bomb) {
          player.activeBombs++;
          player.lastPlacedBombId = bomb.id;
          player.ultraGauge = 0;
          sounds.playHurry();
          this.particles.addItemGetParticles(player.x, player.y, '#f59e0b');
          this.particles.triggerShake(4, 10);
          if (player.config.id === 0) this.input.vibrate(0, 180, 0.7, 0.4);
          this.broadcastStats();
          return true;
        }
        return false;
      }

      case 'ULTRA_FORTRESS': {
        player.shield = 2;
        player.invulnerableTimer = Math.max(player.invulnerableTimer, 120);
        player.ultraGauge = 0;
        sounds.playShieldBreak();
        this.particles.addItemGetParticles(player.x, player.y, '#10b981');
        if (player.config.id === 0) this.input.vibrate(0, 180, 0.6, 0.3);
        this.broadcastStats();
        return true;
      }

      case 'ULTRA_METEOR_TACKLE': {
        if (player.isColliding(player.x + dx * 16, player.y + dy * 16, this.map, this.bombManager)) {
          return false;
        }
        player.startTackle(dx, dy, 3 * 48, 6.0, true, 'none');
        player.ultraGauge = 0;
        sounds.playKick();
        this.particles.addItemGetParticles(player.x, player.y, '#a855f7');
        if (player.config.id === 0) this.input.vibrate(0, 180, 0.7, 0.3);
        this.broadcastStats();
        return true;
      }

      case 'YANGYANG_TEMPEST_ZONE': {
        // Create a 3x3 tempest slash zone centered 1 tile in front of Yangyang for 4 seconds (240 frames)
        const centerTx = Math.max(1, Math.min(13, player.tileX + dx));
        const centerTy = Math.max(1, Math.min(11, player.tileY + dy));
        player.ultraGauge = 0;
        this.activeTempestZones.push({
          ownerId: player.config.id,
          centerTx,
          centerTy,
          remainingFrames: 240,
        });
        sounds.playHurry();
        this.particles.triggerShake(5, 16);
        this.particles.addItemGetParticles(centerTx * 48 + 24, centerTy * 48 + 24, '#2dd4bf');
        if (player.config.id === 0) {
          this.input.vibrate(0, 240, 0.8, 0.45);
        }
        this.broadcastStats();
        return true;
      }
    }

    return false;
  }

  /**
   * Updates Yangyang's forward 2-tile wind slash projectiles (2s stun on hit)
   */
  private updateWindSlashes() {
    for (let i = this.activeWindSlashes.length - 1; i >= 0; i--) {
      const ws = this.activeWindSlashes[i];
      const step = Math.min(ws.speed, ws.remainingDist);
      ws.x += ws.dx * step;
      ws.y += ws.dy * step;
      ws.remainingDist -= step;
      ws.tick++;

      // Stop if hitting a solid wall tile
      const tx = Math.floor(ws.x / 48);
      const ty = Math.floor(ws.y / 48);
      if (this.map.getTile(tx, ty) === 1) {
        this.particles.addBlockDebris(ws.x, ws.y, 4);
        this.activeWindSlashes.splice(i, 1);
        continue;
      }

      // Flurry slash visuals every 2 frames
      if (ws.tick % 2 === 1) {
        const baseAngle = Math.atan2(ws.dy, ws.dx) + (Math.random() - 0.5) * 0.9;
        const flip = ws.tick % 4 === 1;
        this.particles.addSlashEffect(ws.x, ws.y, baseAngle, 34, flip ? '#2dd4bf' : '#99f6e4', flip);
      }

      // Hit check against opponents (2 seconds = 120 frames stun)
      for (const other of this.players) {
        if (other.isAlive && other.config.id !== ws.ownerId && !ws.hitEnemies.has(other.config.id)) {
          if (Math.hypot(other.x - ws.x, other.y - ws.y) < 34) {
            ws.hitEnemies.add(other.config.id);
            other.stun(120);
            this.particles.addItemGetParticles(other.x, other.y, '#2dd4bf');
            this.particles.addExplosionParticles(other.x, other.y, 6);
            this.particles.triggerShake(4, 8);
            if (other.config.id === 0) {
              this.input.vibrate(0, 220, 0.7, 0.35);
            }
          }
        }
      }

      if (ws.remainingDist <= 0) {
        this.activeWindSlashes.splice(i, 1);
      }
    }
  }

  /**
   * Updates Yangyang's 3x3 tempest slash zones (4s duration, 2s stun on hit)
   */
  private updateTempestZones() {
    for (let i = this.activeTempestZones.length - 1; i >= 0; i--) {
      const zone = this.activeTempestZones[i];
      zone.remainingFrames--;

      const centerPx = zone.centerTx * 48 + 24;
      const centerPy = zone.centerTy * 48 + 24;

      // Spawn flurry slash visuals across the 3x3 area
      if (zone.remainingFrames % 4 === 0) {
        const ox = centerPx + (Math.random() - 0.5) * 116;
        const oy = centerPy + (Math.random() - 0.5) * 116;
        const angle = Math.random() * Math.PI * 2;
        const flip = Math.random() < 0.5;
        this.particles.addSlashEffect(ox, oy, angle, 28, flip ? '#2dd4bf' : '#99f6e4', flip);
      }

      // Stun any opponent inside the 3x3 zone for 2 seconds (120 frames)
      for (const other of this.players) {
        if (other.isAlive && other.config.id !== zone.ownerId && other.stunTimer <= 0) {
          if (Math.abs(other.x - centerPx) <= 72 && Math.abs(other.y - centerPy) <= 72) {
            other.stun(120);
            this.particles.addItemGetParticles(other.x, other.y, '#2dd4bf');
            this.particles.addExplosionParticles(other.x, other.y, 5);
            if (other.config.id === 0) {
              this.input.vibrate(0, 220, 0.7, 0.35);
            }
          }
        }
      }

      if (zone.remainingFrames <= 0) {
        this.activeTempestZones.splice(i, 1);
      }
    }
  }

  /**
   * Executes a single sword slash in front of player (0..1 tiles) and stuns hit opponents for 3s
   */
  private performSlashHit(
    player: Player,
    dx: number,
    dy: number,
    flip: boolean,
    isTempest: boolean = false
  ) {
    const baseAngle = Math.atan2(dy, dx);
    const angleJitter = isTempest ? (Math.random() - 0.5) * 0.9 : 0;
    const radius = isTempest ? 44 : 38;
    const slashX = player.x + dx * 20;
    const slashY = player.y + dy * 20;

    this.particles.addSlashEffect(slashX, slashY, baseAngle + angleJitter, radius, isTempest ? '#7dd3fc' : '#38bdf8', flip);
    sounds.playKick();

    // Hit check across 0..1 tiles forward (center at player and +1 tile forward)
    const hitPoints = [
      { x: player.x, y: player.y },
      { x: player.x + dx * 44, y: player.y + dy * 44 },
    ];

    for (const other of this.players) {
      if (other.isAlive && other.config.id !== player.config.id) {
        const hit = hitPoints.some((pt) => Math.hypot(other.x - pt.x, other.y - pt.y) < 36);
        if (hit) {
          other.stun(180); // 3 seconds stun
          this.particles.addItemGetParticles(other.x, other.y, '#facc15');
          this.particles.addExplosionParticles(other.x, other.y, 6);
          this.particles.triggerShake(4, 10);
          if (other.config.id === 0) {
            this.input.vibrate(0, 260, 0.8, 0.4);
          }
        }
      }
    }
  }

  /**
   * Updates Chen's 2-slash windup before transitioning to 0..2 tile slash rush
   */
  private updateChenSlashSequence(player: Player) {
    if (!player.isAlive || player.stunTimer > 0) {
      player.cancelTackle();
      return;
    }

    player.slashSequenceTimer--;

    // 2nd slash halfway through windup
    if (player.slashSequenceTimer === 9) {
      this.performSlashHit(player, player.slashSeqDx, player.slashSeqDy, true);
      if (player.config.id === 0) {
        this.input.vibrate(0, 100, 0.5, 0.25);
      }
    }

    // Windup complete -> start 0..2 tile slash rush
    if (player.slashSequenceTimer <= 0) {
      player.slashSequenceTimer = 0;
      const dx = player.slashSeqDx;
      const dy = player.slashSeqDy;
      if (!player.isColliding(player.x + dx * 16, player.y + dy * 16, this.map, this.bombManager)) {
        player.startTackle(dx, dy, 2 * 48, 5.2, false, 'skill_rush');
        this.updatePlayerTackle(player);
      }
    }
  }

  /**
   * Updates continuous tackle / slash rush movement and collision
   */
  private updatePlayerTackle(player: Player) {
    if (!player.isTackling || !player.isAlive) return;

    if (player.stunTimer > 0) {
      player.cancelTackle();
      return;
    }

    const step = Math.min(player.tackleSpeed, player.tackleRemainingDist);
    const nextX = player.x + player.tackleDx * step;
    const nextY = player.y + player.tackleDy * step;

    // Check collision with obstacles (wall, soft block, solid bomb)
    if (player.isColliding(nextX, nextY, this.map, this.bombManager)) {
      player.cancelTackle();
      sounds.playWallThud();
      this.particles.addItemGetParticles(player.x, player.y, player.config.accentColor);
      this.particles.triggerShake(3, 8);
      return;
    }

    // Advance position
    player.x = nextX;
    player.y = nextY;
    player.tackleRemainingDist -= step;
    player.tackleSlashTick++;
    player.isMoving = true;
    player.animFrame += 2;

    // Trail & slash effects depending on mode
    if (player.tackleSlashMode === 'skill_rush') {
      if (player.tackleSlashTick % 6 === 1) {
        this.performSlashHit(player, player.tackleDx, player.tackleDy, player.tackleSlashTick % 12 > 6, false);
      }
    } else if (player.tackleSlashMode === 'ultra_tempest') {
      if (player.tackleSlashTick % 3 === 1) {
        this.performSlashHit(player, player.tackleDx, player.tackleDy, player.tackleSlashTick % 6 > 3, true);
      }
    } else {
      if (Math.random() < 0.65) {
        this.particles.addItemGetParticles(player.x, player.y, '#c084fc');
      }
    }

    // Check collision against opponents
    for (const other of this.players) {
      if (other.isAlive && other.config.id !== player.config.id && !player.tackleHitEnemies.has(other.config.id)) {
        const dist = Math.hypot(other.x - player.x, other.y - player.y);
        if (dist < 36) {
          player.tackleHitEnemies.add(other.config.id);
          const stunDuration = player.config.ultraType === 'ULTRA_METEOR_TACKLE' && player.tackleSpeed > 5.5 ? 240 : 180;
          other.stun(stunDuration); // 3 seconds (or 4s for Meteor Tackle)
          this.particles.addItemGetParticles(other.x, other.y, '#facc15');
          this.particles.addExplosionParticles(other.x, other.y, 8);
          this.particles.triggerShake(5, 12);
          sounds.playKick();
          if (player.config.id === 0) {
            this.input.vibrate(0, 200, 0.8, 0.4);
          }
          if (other.config.id === 0) {
            this.input.vibrate(0, 300, 0.8, 0.5);
          }
          if (player.tackleStopOnHit) {
            player.cancelTackle();
            return;
          }
        }
      }
    }

    // Finished tackle distance
    if (player.tackleRemainingDist <= 0) {
      player.cancelTackle();
      this.particles.addItemGetParticles(player.x, player.y, '#ffffff');
    }
  }

  /**
   * Drops an indestructible wall on the next spiral coordinate,
   * crushing any soft blocks, items, bombs, and players on that tile.
   */
  private dropNextSuddenDeathWall() {
    // Leave at least the center 3x3 tiles open to avoid 100% full board
    if (this.suddenDeathIndex >= this.suddenDeathPath.length - 9) {
      return;
    }

    const { x, y } = this.suddenDeathPath[this.suddenDeathIndex];
    this.suddenDeathIndex++;

    // If already a wall (e.g. inner pillar), still proceed to next
    const currentTile = this.map.getTile(x, y);
    if (currentTile === 1) { // TILE.WALL
      return;
    }

    // Set tile to indestructible wall
    this.map.setTile(x, y, 1); // TILE.WALL

    // Remove any items on this tile
    this.map.burnItemAt(x, y);

    // Remove any soft block items hidden here
    this.map.hiddenItems.delete(`${x},${y}`);

    // Remove / trigger any bomb on this tile
    const bombIndex = this.bombManager.bombs.findIndex((b) => b.tileX === x && b.tileY === y);
    if (bombIndex !== -1) {
      const b = this.bombManager.bombs[bombIndex];
      this.bombManager.bombs.splice(bombIndex, 1);
      const owner = this.players.find((p) => p.config.id === b.ownerId);
      if (owner && owner.activeBombs > 0) owner.activeBombs--;
    }

    // Impact FX and sound
    const px = x * 48 + 24;
    const py = y * 48 + 24;
    sounds.playWallThud();
    this.particles.triggerShake(4, 8);
    this.particles.addBlockDebris(px, py, 14);

    // Check if any player is crushed by this wall
    for (const p of this.players) {
      if (p.isAlive && p.tileX === x && p.tileY === y) {
        // Direct crush is instantly fatal regardless of shield
        p.shield = 0;
        p.hit();
        sounds.playPlayerDeath();
        this.particles.triggerShake(8, 20);
        this.particles.addExplosionParticles(p.x, p.y, 24);
        if (p.config.id === 0) {
          this.input.vibrate(0, 500, 1.0, 0.9);
        }
      }
    }
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
      if (this.isOnlineHost) {
        this.emitSound('roundOver');
        this.onHostSnapshot?.(this.exportSnapshot());
      }
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
      this.round,
      this.overheadTagTimer
    );

    // Overlay state messages and active 3x3 tempest zones
    const ctx = this.canvas.getContext('2d')!;
    this.drawTempestZones(ctx);

    if (this.state === 'COUNTDOWN') {
      const count = Math.ceil(this.countdownTimer / 60);
      const label = count > 0 ? `${count}` : 'BATTLE!';
      this.drawBigBanner(ctx, label, '#facc15');
    } else if (this.state === 'ROUND_OVER') {
      const bannerText = this.roundWinner ? `${this.roundWinner.config.name} WINS!` : 'DRAW GAME!';
      const bannerColor = this.roundWinner ? this.roundWinner.config.accentColor : '#94a3b8';
      this.drawBigBanner(ctx, bannerText, bannerColor, 'Press (A) / [R] for Next Round');
    }
  }

  private drawTempestZones(ctx: CanvasRenderingContext2D) {
    if (this.activeTempestZones.length === 0) return;
    const now = Date.now();
    for (const zone of this.activeTempestZones) {
      const left = (zone.centerTx - 1) * 48;
      const top = (zone.centerTy - 1) * 48;
      const size = 3 * 48;
      const fade = Math.min(1, zone.remainingFrames / 30);
      const pulse = 0.65 + 0.35 * Math.sin(now / 120);

      ctx.save();
      ctx.globalAlpha = 0.22 * fade * pulse;
      ctx.fillStyle = '#2dd4bf';
      ctx.fillRect(left, top, size, size);

      ctx.globalAlpha = 0.8 * fade;
      ctx.strokeStyle = '#99f6e4';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -(now / 30) % 14;
      ctx.strokeRect(left + 1, top + 1, size - 2, size - 2);
      ctx.restore();
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

  public exportSnapshot(): GameSnapshot {
    return {
      state: this.state,
      round: this.round,
      roundTimeSeconds: this.roundTimeSeconds,
      countdownTimer: this.countdownTimer,
      overheadTagTimer: this.overheadTagTimer,
      roundOverTimer: this.roundOverTimer,
      isHurryUp: this.isHurryUp,
      scores: [...this.scores],
      winnerId: this.roundWinner ? this.roundWinner.config.id : null,
      grid: this.map.grid.map((row) => [...row]),
      activeItems: this.map.activeItems.map((it) => ({ ...it })),
      bombs: this.bombManager.bombs.map((b) => ({
        id: b.id,
        tileX: b.tileX,
        tileY: b.tileY,
        pixelX: b.pixelX,
        pixelY: b.pixelY,
        ownerId: b.ownerId,
        power: b.power,
        fuseTimer: (b as any).timer ?? 150,
        maxFuseTime: 150,
        isMega: Boolean((b as any).isMega),
        isSliding: b.isSliding,
        slideDx: b.slideDx,
        slideDy: b.slideDy,
      })),
      explosions: this.bombManager.explosions.cells.map((c) => ({ ...c })),
      players: this.players.map((p) => ({
        id: p.config.id,
        x: p.x,
        y: p.y,
        speed: p.speed,
        facing: p.facing,
        animFrame: p.animFrame,
        isMoving: p.isMoving,
        isAlive: p.isAlive,
        deathTimer: p.deathTimer,
        stunTimer: p.stunTimer,
        invulnerableTimer: p.invulnerableTimer,
        maxBombs: p.maxBombs,
        activeBombs: p.activeBombs,
        power: p.power,
        hasKick: p.hasKick,
        shield: p.shield,
        skillCooldownTimer: p.skillCooldownTimer,
        ultraGauge: p.ultraGauge,
        hasMegaBomb: p.hasMegaBomb,
        isTackling: p.isTackling,
        tackleSlashMode: p.tackleSlashMode,
        tackleSlashTick: p.tackleSlashTick,
        slashSequenceTimer: p.slashSequenceTimer,
      })),
      windSlashes: this.activeWindSlashes.map((ws) => ({
        ownerId: ws.ownerId,
        x: ws.x,
        y: ws.y,
        dx: ws.dx,
        dy: ws.dy,
        tick: ws.tick,
      })),
      tempestZones: this.activeTempestZones.map((tz) => ({ ...tz })),
    };
  }

  public applySnapshot(snap: GameSnapshot) {
    if (!snap) return;

    if (this.players.length === 0) {
      this.setupPlayers();
    }

    this.state = snap.state;
    this.round = snap.round;
    this.roundTimeSeconds = snap.roundTimeSeconds;
    this.countdownTimer = snap.countdownTimer;
    this.overheadTagTimer = snap.overheadTagTimer;
    this.roundOverTimer = snap.roundOverTimer;
    this.isHurryUp = snap.isHurryUp;
    this.scores = [...snap.scores];
    this.roundWinner = snap.winnerId !== null
      ? (this.players.find((p) => p.config.id === snap.winnerId) || null)
      : null;

    if (snap.grid && snap.grid.length > 0) {
      this.map.grid = snap.grid.map((row) => [...row]);
    }
    if (snap.activeItems) {
      this.map.activeItems = snap.activeItems.map((it) => ({ ...it }));
    }

    if (snap.bombs) {
      this.bombManager.bombs = snap.bombs.map((b) => {
        const bomb = new Bomb(b.id, b.ownerId, b.tileX, b.tileY, b.power);
        bomb.pixelX = b.pixelX;
        bomb.pixelY = b.pixelY;
        bomb.timer = b.fuseTimer ?? 150;
        bomb.isSliding = b.isSliding;
        bomb.slideDx = b.slideDx;
        bomb.slideDy = b.slideDy;
        (bomb as any).isMega = b.isMega;
        return bomb;
      });
    }

    if (snap.explosions) {
      if (snap.explosions.length > 0 && this.bombManager.explosions.cells.length === 0) {
        this.particles.triggerShake(4, 10);
      }
      this.bombManager.explosions.cells = snap.explosions.map((c) => ({ ...c }));
    }

    if (snap.players) {
      for (const sp of snap.players) {
        const p = this.players.find((pl) => pl.config.id === sp.id);
        if (!p) continue;
        p.x = sp.x;
        p.y = sp.y;
        p.speed = sp.speed ?? p.speed;
        p.facing = sp.facing;
        p.animFrame = sp.animFrame;
        p.isMoving = sp.isMoving;
        p.isAlive = sp.isAlive;
        p.deathTimer = sp.deathTimer;
        p.stunTimer = sp.stunTimer;
        p.invulnerableTimer = sp.invulnerableTimer;
        p.maxBombs = sp.maxBombs;
        p.activeBombs = sp.activeBombs;
        p.power = sp.power;
        p.hasKick = sp.hasKick;
        p.shield = sp.shield;
        p.skillCooldownTimer = sp.skillCooldownTimer;
        p.ultraGauge = sp.ultraGauge;
        p.hasMegaBomb = sp.hasMegaBomb;
        p.isTackling = sp.isTackling;
        p.tackleSlashMode = sp.tackleSlashMode;
        p.tackleSlashTick = sp.tackleSlashTick;
        p.slashSequenceTimer = sp.slashSequenceTimer;
      }
    }

    if (snap.windSlashes) {
      this.activeWindSlashes = snap.windSlashes.map((ws) => ({
        ...ws,
        remainingDist: 0,
        speed: 0,
        hitEnemies: new Set<number>(),
      }));
    }
    if (snap.tempestZones) {
      this.activeTempestZones = snap.tempestZones.map((tz) => ({ ...tz }));
    }

    this.broadcastStats();
  }
}
