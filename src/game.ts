// Game Engine, State Machine, and Main Loop for AI-Bomberman

import {
  PLAYER_CONFIGS,
  PLAYER_SLOT_COLORS,
  CHARACTERS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PlayerConfig,
  ItemSettings,
  DEFAULT_ITEM_SETTINGS,
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

  public activeSpearStrikes: Array<{
    ownerId: number;
    centerTx: number;
    centerTy: number;
    warningFrames: number;
    impactFrames: number;
  }> = [];

  public activeSanctuaryZones: Array<{
    ownerId: number;
    centerTx: number;
    centerTy: number;
    remainingFrames: number;
  }> = [];

  public activeFlameWalls: Array<{
    ownerId: number;
    tileX: number;
    tileY: number;
    remainingFrames: number;
  }> = [];

  public activePhoenixFlames: Array<{
    ownerId: number;
    centerTx: number;
    centerTy: number;
    remainingFrames: number;
  }> = [];

  private isRunning: boolean = false;
  private animFrameId: number | null = null;

  // Match Rules & Item Settings
  public itemSettings: ItemSettings = { ...DEFAULT_ITEM_SETTINGS };
  private lastBombPressTime: Map<number, number> = new Map();

  // Online Multiplayer State
  public isOnlineHost: boolean = false;
  public isOnlineGuest: boolean = false;
  public remoteInputs: Map<number, RemoteInputPayload> = new Map();
  private lastGuestInputSent: RemoteInputPayload = { dx: 0, dy: 0, bomb: false, skill: false, ultra: false };
  private syncTickCounter: number = 0;
  private lastExportedGridVersion: number = -1;
  private snapshotCounter: number = 0;
  private lastRenderedIdleState: string = '';

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

  public updateSlotControlLive(
    slotIndex: number,
    control: '1P' | 'COM' | 'OFF' | 'REMOTE',
    charId?: string
  ) {
    const slot = this.playerSlots[slotIndex];
    if (!slot) return;
    slot.control = control;
    if (charId && (this.state === 'TITLE' || this.state === 'SETUP')) {
      slot.charId = charId;
    }

    if (this.state === 'TITLE' || this.state === 'SETUP') {
      this.setupPlayers();
      this.broadcastStats();
      return;
    }

    // Live match in progress: update existing player control / AI without resetting positions
    const p = this.players.find((pl) => pl.config.id === slotIndex);
    if (p) {
      const fallbackChar = Object.values(CHARACTERS)[0];
      const charData = CHARACTERS[p.config.charId] || CHARACTERS[slot.charId] || fallbackChar;
      const isHuman = control === '1P' || control === 'REMOTE';
      const labelPrefix =
        control === '1P' ? '1P' : control === 'REMOTE' ? `${slotIndex + 1}P` : `COM ${slotIndex + 1}`;
      const tag = control === 'REMOTE' ? `${slotIndex + 1}P` : control;
      p.config.isHuman = isHuman;
      p.config.name = `${labelPrefix} (${charData.jpName})`;
      p.config.nameTag = tag;

      this.aiControllers = this.aiControllers.filter((ai) => (ai as any).player?.config?.id !== slotIndex);
      if (!isHuman && control === 'COM') {
        this.aiControllers.push(new AIController(p));
      }
    }
    this.comCount = this.players.filter((pl) => !pl.config.isHuman).length;
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

  public setItemSettings(settings: ItemSettings) {
    this.itemSettings = { ...settings };
  }

  public startRound() {
    this.map.reset(0.65, this.itemSettings);
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
    this.activeSpearStrikes = [];
    this.activeSanctuaryZones = [];
    this.activeFlameWalls = [];
    this.activePhoenixFlames = [];

    for (const p of this.players) {
      p.reset();
    }

    sounds.playCountdownTick();
    this.emitSound('countdownTick');

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
      dx: input.dx !== 0 ? input.dx : (prev && (prev as any)._unconsumedDir ? prev.dx : input.dx),
      dy: input.dy !== 0 ? input.dy : (prev && (prev as any)._unconsumedDir ? prev.dy : input.dy),
      bomb: Boolean(prev?.bomb || input.bomb),
      chainBomb: Boolean(prev?.chainBomb || input.chainBomb),
      skill: Boolean(prev?.skill || input.skill),
      ultra: Boolean(prev?.ultra || input.ultra),
      ...(input.dx !== 0 || input.dy !== 0 ? { _unconsumedDir: true } : {}),
    } as RemoteInputPayload);
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

        if (!document.hidden) {
          const isIdleOverlayState =
            this.state === 'TITLE' || this.state === 'SETUP' || this.state === 'PAUSED';
          if (isIdleOverlayState) {
            if (this.lastRenderedIdleState !== this.state) {
              this.lastRenderedIdleState = this.state;
              this.render();
            }
          } else {
            this.lastRenderedIdleState = '';
            this.render();
          }
        }
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
    this.particles.recordFxEvents = this.isOnlineHost;

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
          this.lastGuestInputSent = {
            ...payload,
            bomb: false,
            chainBomb: false,
            skill: false,
            ultra: false,
          };
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
      if (this.countdownTimer === 120 || this.countdownTimer === 60) {
        sounds.playCountdownTick();
        this.emitSound('countdownTick');
      } else if (this.countdownTimer <= 0) {
        this.state = 'PLAYING';
        sounds.playBattleStart();
        this.emitSound('battleStart');
        this.broadcastStats();
      }
      this.particles.update();
      this.input.endFrame();
      if (this.isOnlineHost) {
        this.syncTickCounter++;
        if (
          this.syncTickCounter % 2 === 0 ||
          this.countdownTimer === 120 ||
          this.countdownTimer === 60 ||
          this.state === 'PLAYING'
        ) {
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

    // Update active tackles, slash sequences, flights, and Changli aerial/phoenix skills
    for (const p of this.players) {
      if (!p.isAlive) continue;
      if (p.isFlying) {
        this.updatePlayerFlight(p);
      } else if (p.changliSkillTimer > 0) {
        this.updateChangliSkill(p);
      } else if (p.slashSequenceTimer > 0) {
        this.updateChenSlashSequence(p);
      } else if (p.isTackling) {
        this.updatePlayerTackle(p);
      }
      if (p.changliUltraTimer > 0) {
        p.changliUltraTimer--;
      }
    }

    // Update Yangyang's wind slashes, 3x3 tempest zones, Aemeath's spear strikes, Shorekeeper's sanctuaries, and Changli's flame effects
    this.updateWindSlashes();
    this.updateTempestZones();
    this.updateSpearStrikes();
    this.updateSanctuaryZones();
    this.updateFlameWalls();
    this.updatePhoenixFlames();

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
        // Consume one-shot button presses and unconsumed directional tap flag
        remote.bomb = false;
        remote.chainBomb = false;
        remote.skill = false;
        remote.ultra = false;
        (remote as any)._unconsumedDir = false;
      }

      if (!hp.isActionLocked) {
        hp.move(hInput.dx, hInput.dy, this.map, this.bombManager, () => {
          sounds.playKick();
          this.emitSound('kick');
        });

        if (hInput.bomb) {
          const standingOnBomb = Boolean(this.bombManager.getBombAt(hp.tileX, hp.tileY));
          if (
            standingOnBomb &&
            (hp.chainBombAmmo > 0 || (hp.config.skillType === 'CHAIN_BOMB' && hp.skillCooldownTimer === 0))
          ) {
            this.tryUseChainBomb(hp);
          } else {
            this.tryPlaceBomb(hp);
          }
        }

        if (hInput.skill) {
          if (this.tryUseSkill(hp)) {
            if (hp.isTackling) {
              this.updatePlayerTackle(hp);
            }
            if (this.isOnlineHost) {
              this.onHostSnapshot?.(this.exportSnapshot());
            }
          }
        }
        if (hInput.ultra) {
          if (this.tryUseUltra(hp)) {
            if (hp.isTackling) {
              this.updatePlayerTackle(hp);
            }
            if (this.isOnlineHost) {
              this.onHostSnapshot?.(this.exportSnapshot());
            }
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

    // 2. COM Opponents AI update (share a single dangerMap computation across all COMs)
    if (this.aiControllers.length > 0) {
      const sharedDangerMap = AIController.calculateDangerMap(this.map, this.bombManager);
      for (const ai of this.aiControllers) {
        ai.update(
          this.map,
          this.bombManager,
          this.players,
          (p) => this.tryPlaceBomb(p),
          sharedDangerMap,
          (p) => this.tryUseSkill(p),
          (p) => this.tryUseUltra(p),
          (p) => this.tryUseChainBomb(p)
        );
      }
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
      if (!p.isAlive || p.isImmuneToBombs || this.isProtectedBySanctuary(p)) continue;

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
    if (!player.canAct) return false;
    if (player.activeBombs >= player.maxBombs) return false;

    // Determine all players overlapping this tile right now
    const overlappingPlayers = this.players
      .filter((p) => p.isAlive && Math.hypot(p.x - (player.tileX * 48 + 24), p.y - (player.tileY * 48 + 24)) < 36)
      .map((p) => p.config.id);

    const isMega = player.hasMegaBomb;
    const power = isMega ? Math.min(8, player.power + 4) : player.power;

    const bomb = this.bombManager.placeBomb(
      player.config.id,
      player.tileX,
      player.tileY,
      power,
      overlappingPlayers
    );

    if (bomb) {
      if (isMega) {
        player.hasMegaBomb = false;
        (bomb as any).isMega = true;
        this.particles.triggerShake(4, 8);
        this.particles.addItemGetParticles(bomb.pixelX, bomb.pixelY, '#f59e0b');
      }
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
   * Executes Chain Bomb (連爆) skill: when standing on a placed bomb, places remaining available bombs in facing direction
   */
  public tryUseChainBomb(player: Player): boolean {
    if (!player.canAct) return false;
    if (player.chainBombAmmo <= 0 && player.config.skillType !== 'CHAIN_BOMB') return false;
    if (player.config.skillType === 'CHAIN_BOMB' && player.chainBombAmmo <= 0 && player.skillCooldownTimer > 0) return false;

    // Must be standing on an already-placed bomb
    const standingBomb = this.bombManager.getBombAt(player.tileX, player.tileY);
    if (!standingBomb) return false;

    const availableBombs = player.maxBombs - player.activeBombs;
    if (availableBombs <= 0) return false;

    const { dx, dy } = player.getFacingVector();

    const targetTiles: Array<{ x: number; y: number }> = [];

    // Extend forward along facing direction up to currently available bomb count
    for (let step = 1; step <= availableBombs; step++) {
      const tx = player.tileX + dx * step;
      const ty = player.tileY + dy * step;

      if (tx < 1 || tx >= 14 || ty < 1 || ty >= 12) break;
      if (!this.map.isWalkable(tx, ty)) break;
      if (this.bombManager.getBombAt(tx, ty)) break;

      targetTiles.push({ x: tx, y: ty });
    }

    if (targetTiles.length === 0) {
      return false;
    }

    let placedAny = false;
    for (let i = 0; i < targetTiles.length; i++) {
      const { x: tx, y: ty } = targetTiles[i];
      const overlapping = this.players
        .filter((p) => p.isAlive && Math.hypot(p.x - (tx * 48 + 24), p.y - (ty * 48 + 24)) < 36)
        .map((p) => p.config.id);

      const bomb = this.bombManager.placeBomb(player.config.id, tx, ty, player.power, overlapping);
      if (bomb) {
        placedAny = true;
        player.activeBombs++;
        player.lastPlacedBombId = bomb.id;
        // Chain cleanly right after the standing bomb
        bomb.timer = Math.min(150, Math.max(40, standingBomb.timer) + (i + 1) * 8);
        this.particles.addItemGetParticles(bomb.pixelX, bomb.pixelY, '#fbbf24');
      }
    }

    if (!placedAny) return false;

    sounds.playBombDrop();
    this.particles.triggerShake(5, 12);
    if (this.isOnlineHost) {
      this.emitSound('placeBomb');
    }

    if (player.chainBombAmmo > 0) {
      player.chainBombAmmo--;
    } else if (player.config.skillType === 'CHAIN_BOMB') {
      player.skillCooldownTimer = player.config.skillCooldown || 600;
    }

    if (player.config.id === 0) {
      this.input.vibrate(0, 180, 0.7, 0.4);
    }

    if (this.isOnlineHost) {
      this.onHostSnapshot?.(this.exportSnapshot());
    }
    this.broadcastStats();
    return true;
  }

  private vibrateIfP1(playerId: number, durationMs: number, weak: number, strong: number) {
    if (playerId === 0) {
      this.input.vibrate(0, durationMs, weak, strong);
    }
  }

  private removeBombAtIndex(index: number) {
    const bomb = this.bombManager.bombs[index];
    if (!bomb) return null;
    this.bombManager.bombs.splice(index, 1);
    const owner = this.players.find((p) => p.config.id === bomb.ownerId);
    if (owner && owner.activeBombs > 0) {
      owner.activeBombs--;
    }
    return bomb;
  }

  private applyStunHit(
    target: Player,
    stunFrames: number,
    particleColor: string,
    explosionParticles: number = 6,
    vibrateMs: number = 220
  ) {
    target.stun(stunFrames);
    this.particles.addItemGetParticles(target.x, target.y, particleColor);
    if (explosionParticles > 0) {
      this.particles.addExplosionParticles(target.x, target.y, explosionParticles);
    }
    this.vibrateIfP1(target.config.id, vibrateMs, 0.8, 0.45);
  }

  private stunEnemiesInArea(
    ownerId: number,
    predicate: (other: Player) => boolean,
    stunFrames: number,
    particleColor: string,
    explosionParticles: number = 6,
    vibrateMs: number = 220
  ): number {
    let hitCount = 0;
    for (const other of this.players) {
      if (other.isAlive && other.config.id !== ownerId && !this.isProtectedFromAttack(other) && predicate(other)) {
        this.applyStunHit(other, stunFrames, particleColor, explosionParticles, vibrateMs);
        hitCount++;
      }
    }
    return hitCount;
  }

  private applyTeleportDash(player: Player, steps: number, invulnFrames: number, particleColor: string): boolean {
    const { dx, dy } = player.getFacingVector();
    const targetTx = Math.max(1, Math.min(13, player.tileX + dx * steps));
    const targetTy = Math.max(1, Math.min(11, player.tileY + dy * steps));

    if (!this.map.isWalkable(targetTx, targetTy) || this.bombManager.getBombAt(targetTx, targetTy)) {
      return false;
    }

    this.particles.addItemGetParticles(player.x, player.y, particleColor);
    player.x = targetTx * 48 + 24;
    player.y = targetTy * 48 + 24;
    if (invulnFrames > 0) {
      player.invulnerableTimer = Math.max(player.invulnerableTimer, invulnFrames);
    }
    sounds.playKick();
    this.emitSound('kick');
    this.particles.addItemGetParticles(player.x, player.y, '#ffffff');
    this.vibrateIfP1(player.config.id, invulnFrames > 0 ? 150 : 100, 0.5, 0.25);
    return true;
  }

  private getClampedTileBox(centerTx: number, centerTy: number, radius: number) {
    const minTx = Math.max(1, centerTx - radius);
    const maxTx = Math.min(13, centerTx + radius);
    const minTy = Math.max(1, centerTy - radius);
    const maxTy = Math.min(11, centerTy + radius);
    return {
      left: minTx * 48,
      top: minTy * 48,
      width: (maxTx - minTx + 1) * 48,
      height: (maxTy - minTy + 1) * 48,
      cx: centerTx * 48 + 24,
      cy: centerTy * 48 + 24,
    };
  }

  /**
   * Executes unique character skill
   */
  public tryUseSkill(player: Player): boolean {
    if (!player.canAct || player.skillCooldownTimer > 0) return false;

    const skillType = player.config.skillType;
    const { dx, dy } = player.getFacingVector();

    switch (skillType) {
      case 'CHAIN_BOMB': {
        return this.tryUseChainBomb(player);
      }
      case 'DASH': {
        if (!this.applyTeleportDash(player, 2, 0, player.config.color)) return false;
        player.skillCooldownTimer = player.config.skillCooldown;
        return true;
      }

      case 'TACKLE': {
        if (player.isColliding(player.x + dx * 16, player.y + dy * 16, this.map, this.bombManager)) {
          return false;
        }
        player.startTackle(dx, dy, 2 * 48, 5.0);
        player.skillCooldownTimer = player.config.skillCooldown;
        sounds.playKick();
        this.emitSound('kick');
        this.particles.addItemGetParticles(player.x, player.y, '#c084fc');
        this.vibrateIfP1(player.config.id, 120, 0.5, 0.2);
        return true;
      }

      case 'REMOTE_DETONATE': {
        const targetBomb = this.bombManager.bombs.find((b) => b.ownerId === player.config.id);
        if (!targetBomb) return false;
        targetBomb.timer = 1;
        player.skillCooldownTimer = player.config.skillCooldown;
        sounds.playHurry();
        this.emitSound('hurry');
        this.particles.addItemGetParticles(targetBomb.pixelX, targetBomb.pixelY, '#ef4444');
        this.vibrateIfP1(player.config.id, 150, 0.6, 0.3);
        return true;
      }

      case 'MEGA_BOMB': {
        player.hasMegaBomb = true;
        player.skillCooldownTimer = player.config.skillCooldown;
        sounds.playHurry();
        this.emitSound('hurry');
        this.particles.addItemGetParticles(player.x, player.y, '#f59e0b');
        this.vibrateIfP1(player.config.id, 150, 0.5, 0.3);
        return true;
      }

      case 'SHIELD_DEPLOY': {
        player.shield = Math.min(player.shield + 1, 2);
        player.skillCooldownTimer = player.config.skillCooldown;
        sounds.playShieldBreak();
        this.emitSound('shieldBreak');
        this.particles.addItemGetParticles(player.x, player.y, '#38bdf8');
        this.vibrateIfP1(player.config.id, 150, 0.5, 0.3);
        return true;
      }

      case 'CHEN_SLASH_RUSH': {
        player.slashSequenceTimer = 18;
        player.slashSeqDx = dx;
        player.slashSeqDy = dy;
        player.skillCooldownTimer = player.config.skillCooldown;
        this.performSlashHit(player, dx, dy, false);
        this.vibrateIfP1(player.config.id, 100, 0.5, 0.25);
        return true;
      }

      case 'YANGYANG_WIND_SLASH': {
        player.skillCooldownTimer = player.config.skillCooldown;
        const startX = player.x + dx * 16;
        const startY = player.y + dy * 16;
        this.activeWindSlashes.push({
          ownerId: player.config.id,
          x: startX,
          y: startY,
          dx,
          dy,
          remainingDist: 2 * 48,
          speed: 8.0,
          tick: 0,
          hitEnemies: new Set(),
        });
        sounds.playKick();
        this.emitSound('kick');
        this.particles.addItemGetParticles(player.x, player.y, '#2dd4bf');
        this.particles.addSlashEffect(startX, startY, Math.atan2(dy, dx), 34, '#2dd4bf', false);
        this.vibrateIfP1(player.config.id, 120, 0.5, 0.25);
        return true;
      }

      case 'AEMEATH_FLIGHT': {
        let step = 1;
        let softBlockCount = 0;

        while (true) {
          const tx = player.tileX + dx * step;
          const ty = player.tileY + dy * step;
          if (tx < 1 || tx >= 14 || ty < 1 || ty >= 12) break;
          if (this.map.getTile(tx, ty) === TILE.SOFT_BLOCK) {
            softBlockCount++;
            step++;
          } else {
            break;
          }
        }

        if (softBlockCount === 0) return false;

        const landTx = player.tileX + dx * step;
        const landTy = player.tileY + dy * step;
        if (landTx < 1 || landTx >= 14 || landTy < 1 || landTy >= 12) return false;
        if (!this.map.isWalkable(landTx, landTy)) return false;

        const duration = Math.min(28, 14 + softBlockCount * 4);
        player.startFlight(landTx * 48 + 24, landTy * 48 + 24, duration);
        player.skillCooldownTimer = player.config.skillCooldown || 300;
        sounds.playKick();
        this.emitSound('kick');
        this.particles.addItemGetParticles(player.x, player.y, '#22d3ee');
        this.vibrateIfP1(player.config.id, 100, 0.4, 0.2);
        return true;
      }

      case 'SHOREKEEPER_ERASE_BOMB': {
        const targetTx = player.tileX + dx;
        const targetTy = player.tileY + dy;
        const bombIdx = this.bombManager.bombs.findIndex((b) => b.tileX === targetTx && b.tileY === targetTy);
        if (bombIdx === -1) return false;

        const targetBomb = this.removeBombAtIndex(bombIdx)!;
        player.skillCooldownTimer = player.config.skillCooldown || 360;
        sounds.playShieldBreak();
        this.emitSound('shieldBreak');
        this.particles.addItemGetParticles(targetBomb.pixelX, targetBomb.pixelY, '#60a5fa');
        this.vibrateIfP1(player.config.id, 120, 0.45, 0.25);
        return true;
      }

      case 'CHANGLI_PHOENIX_ASCENT': {
        player.changliSkillTimer = 66;
        player.skillCooldownTimer = player.config.skillCooldown || 360;
        this.particles.addItemGetParticles(player.x, player.y, '#f97316');
        this.vibrateIfP1(player.config.id, 160, 0.55, 0.3);
        return true;
      }
    }

    return false;
  }

  /**
   * Executes Ultra Skill
   */
  public tryUseUltra(player: Player): boolean {
    if (!player.canAct || player.ultraGauge < 10) return false;

    const ultraType = player.config.ultraType;
    const { dx, dy } = player.getFacingVector();

    switch (ultraType) {
      case 'CHEN_TEMPEST_RUSH': {
        player.ultraGauge = 0;
        player.startTackle(dx, dy, 4 * 48, 6.0, false, 'ultra_tempest');
        this.performSlashHit(player, dx, dy, false, true);
        this.particles.triggerShake(5, 16);
        this.vibrateIfP1(player.config.id, 260, 0.8, 0.5);
        this.broadcastStats();
        return true;
      }

      case 'ULTRA_BLITZ_DASH': {
        if (!this.applyTeleportDash(player, 3, 60, '#38bdf8')) return false;
        player.ultraGauge = 0;
        this.broadcastStats();
        return true;
      }

      case 'ULTRA_ALL_DETONATE': {
        const myBombs = this.bombManager.bombs.filter((b) => b.ownerId === player.config.id);
        if (myBombs.length === 0) return false;
        for (const b of myBombs) {
          b.timer = 1;
          this.particles.addItemGetParticles(b.pixelX, b.pixelY, '#ef4444');
        }
        player.ultraGauge = 0;
        sounds.playHurry();
        this.emitSound('hurry');
        this.vibrateIfP1(player.config.id, 200, 0.7, 0.4);
        this.broadcastStats();
        return true;
      }

      case 'ULTRA_NOVA_BOMB': {
        if (player.activeBombs >= player.maxBombs) return false;
        const overlappingPlayers = this.players
          .filter((p) => p.isAlive && Math.hypot(p.x - (player.tileX * 48 + 24), p.y - (player.tileY * 48 + 24)) < 36)
          .map((p) => p.config.id);
        const bomb = this.bombManager.placeBomb(player.config.id, player.tileX, player.tileY, 8, overlappingPlayers);
        if (!bomb) return false;
        (bomb as any).isMega = true;
        player.activeBombs++;
        player.lastPlacedBombId = bomb.id;
        player.ultraGauge = 0;
        sounds.playHurry();
        this.emitSound('hurry');
        this.particles.addItemGetParticles(player.x, player.y, '#f59e0b');
        this.particles.triggerShake(4, 10);
        this.vibrateIfP1(player.config.id, 180, 0.7, 0.4);
        this.broadcastStats();
        return true;
      }

      case 'ULTRA_FORTRESS': {
        player.shield = 2;
        player.invulnerableTimer = Math.max(player.invulnerableTimer, 120);
        player.ultraGauge = 0;
        sounds.playShieldBreak();
        this.emitSound('shieldBreak');
        this.particles.addItemGetParticles(player.x, player.y, '#10b981');
        this.vibrateIfP1(player.config.id, 180, 0.6, 0.3);
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
        this.emitSound('kick');
        this.particles.addItemGetParticles(player.x, player.y, '#a855f7');
        this.vibrateIfP1(player.config.id, 180, 0.7, 0.3);
        this.broadcastStats();
        return true;
      }

      case 'YANGYANG_TEMPEST_ZONE': {
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
        this.emitSound('hurry');
        this.particles.triggerShake(5, 16);
        this.particles.addItemGetParticles(centerTx * 48 + 24, centerTy * 48 + 24, '#2dd4bf');
        this.particles.addSlashEffect(centerTx * 48 + 24, centerTy * 48 + 24, Math.atan2(dy, dx), 42, '#2dd4bf', false);
        this.vibrateIfP1(player.config.id, 240, 0.8, 0.45);
        this.broadcastStats();
        return true;
      }

      case 'AEMEATH_SPEAR_STRIKE': {
        player.ultraGauge = 0;
        this.activeSpearStrikes.push({
          ownerId: player.config.id,
          centerTx: player.tileX,
          centerTy: player.tileY,
          warningFrames: 60,
          impactFrames: 36,
        });
        sounds.playHurry();
        this.emitSound('hurry');
        this.particles.addItemGetParticles(player.x, player.y, '#f472b6');
        this.vibrateIfP1(player.config.id, 160, 0.5, 0.3);
        this.broadcastStats();
        return true;
      }

      case 'SHOREKEEPER_SANCTUARY': {
        player.ultraGauge = 0;
        this.activeSanctuaryZones.push({
          ownerId: player.config.id,
          centerTx: player.tileX,
          centerTy: player.tileY,
          remainingFrames: 300,
        });
        sounds.playShieldBreak();
        this.emitSound('shieldBreak');
        this.particles.addItemGetParticles(player.x, player.y, '#60a5fa');
        this.vibrateIfP1(player.config.id, 200, 0.7, 0.4);
        this.broadcastStats();
        return true;
      }

      case 'CHANGLI_PHOENIX_FLAME': {
        player.ultraGauge = 0;
        player.changliUltraTimer = 48;
        const cx = player.tileX;
        const cy = player.tileY;

        this.activePhoenixFlames.push({
          ownerId: player.config.id,
          centerTx: cx,
          centerTy: cy,
          remainingFrames: 48,
        });

        // Immediately detonate all bombs within 3x3 area
        for (const b of this.bombManager.bombs) {
          if (Math.abs(b.tileX - cx) <= 1 && Math.abs(b.tileY - cy) <= 1) {
            b.timer = 1;
          }
        }

        this.stunEnemiesInArea(
          player.config.id,
          (other) => Math.abs(other.tileX - cx) <= 1 && Math.abs(other.tileY - cy) <= 1,
          180,
          '#f97316',
          10,
          280
        );

        sounds.playExplosion();
        this.emitSound('explosion');
        this.particles.triggerShake(7, 16);
        this.particles.addExplosionParticles(player.x, player.y, 20);
        this.vibrateIfP1(player.config.id, 260, 0.85, 0.5);
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
        if (
          other.isAlive &&
          other.config.id !== ws.ownerId &&
          !ws.hitEnemies.has(other.config.id) &&
          !this.isProtectedFromAttack(other)
        ) {
          if (Math.hypot(other.x - ws.x, other.y - ws.y) < 34) {
            ws.hitEnemies.add(other.config.id);
            other.stun(120);
            sounds.playKick();
            this.emitSound('kick');
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
        if (other.isAlive && other.config.id !== zone.ownerId && other.stunTimer <= 0 && !this.isProtectedFromAttack(other)) {
          if (Math.abs(other.x - centerPx) <= 72 && Math.abs(other.y - centerPy) <= 72) {
            other.stun(120);
            sounds.playKick();
            this.emitSound('kick');
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

  private updatePlayerFlight(player: Player) {
    if (!player.isFlying) return;
    player.flightProgress += 1 / player.flightDuration;
    if (player.flightProgress >= 1) {
      player.flightProgress = 1;
      player.x = player.flightTargetX;
      player.y = player.flightTargetY;
      player.isFlying = false;
      const landingBomb = this.bombManager.getBombAt(player.tileX, player.tileY);
      if (landingBomb) {
        landingBomb.passablePlayers.add(player.config.id);
      }
      this.particles.addItemGetParticles(player.x, player.y, '#22d3ee');
    } else {
      const t = player.flightProgress;
      player.x = player.flightStartX + (player.flightTargetX - player.flightStartX) * t;
      player.y = player.flightStartY + (player.flightTargetY - player.flightStartY) * t;
    }
  }

  private updateSpearStrikes() {
    for (let i = this.activeSpearStrikes.length - 1; i >= 0; i--) {
      const strike = this.activeSpearStrikes[i];
      if (strike.warningFrames > 0) {
        strike.warningFrames--;
        if (strike.warningFrames === 0) {
          // Spear impacts!
          const cx = strike.centerTx * 48 + 24;
          const cy = strike.centerTy * 48 + 24;
          sounds.playExplosion();
          this.emitSound('explosion');
          this.particles.triggerShake(9, 20);
          this.particles.addExplosionParticles(cx, cy, 24);
          this.particles.addItemGetParticles(cx, cy, '#22d3ee');

          // Remove all bombs within 7x7 area (without detonating them)
          for (let bi = this.bombManager.bombs.length - 1; bi >= 0; bi--) {
            const b = this.bombManager.bombs[bi];
            if (Math.abs(b.tileX - strike.centerTx) <= 3 && Math.abs(b.tileY - strike.centerTy) <= 3) {
              this.particles.addItemGetParticles(b.pixelX, b.pixelY, '#22d3ee');
              this.removeBombAtIndex(bi);
            }
          }

          // Stun all enemies within 7x7 area for 4 seconds (240 frames)
          this.stunEnemiesInArea(
            strike.ownerId,
            (other) => Math.abs(other.tileX - strike.centerTx) <= 3 && Math.abs(other.tileY - strike.centerTy) <= 3,
            240,
            '#f472b6',
            0,
            280
          );
        }
      } else {
        strike.impactFrames--;
        if (strike.impactFrames <= 0) {
          this.activeSpearStrikes.splice(i, 1);
        }
      }
    }
  }

  private isProtectedBySanctuary(player: Player): boolean {
    if (this.activeSanctuaryZones.length === 0) return false;
    return this.activeSanctuaryZones.some(
      (z) =>
        z.ownerId === player.config.id &&
        Math.abs(player.tileX - z.centerTx) <= 2 &&
        Math.abs(player.tileY - z.centerTy) <= 2
    );
  }

  private isProtectedFromAttack(player: Player): boolean {
    return this.isProtectedBySanctuary(player) || player.isImmuneToEnemyAttacks;
  }

  private updateSanctuaryZones() {
    for (let i = this.activeSanctuaryZones.length - 1; i >= 0; i--) {
      const zone = this.activeSanctuaryZones[i];
      zone.remainingFrames--;
      if (zone.remainingFrames <= 0) {
        this.activeSanctuaryZones.splice(i, 1);
      }
    }
  }

  private updateChangliSkill(player: Player) {
    if (!player.isAlive || player.changliSkillTimer <= 0) return;
    // If stunned during hover (the only phase vulnerable to enemy attacks), cancel skill
    if (player.stunTimer > 0 && player.isChangliHovering) {
      player.changliSkillTimer = 0;
      return;
    }

    const timerBefore = player.changliSkillTimer;
    player.changliSkillTimer--;

    // Ascent phase (66..31): 6 rapid slashes on own ground tile every 6 frames
    if (timerBefore > 30 && (66 - timerBefore) % 6 === 0) {
      const slashIndex = (66 - timerBefore) / 6;
      const angle = (slashIndex * Math.PI) / 3;
      const flip = slashIndex % 2 === 1;
      this.particles.addSlashEffect(player.x, player.y, angle, 36, flip ? '#f97316' : '#ef4444', flip);
      sounds.playKick();
      this.emitSound('kick');

      this.stunEnemiesInArea(
        player.config.id,
        (other) => other.tileX === player.tileX && other.tileY === player.tileY,
        180,
        '#f97316',
        6,
        200
      );
    }

    // Hover phase embers
    if (timerBefore <= 30 && timerBefore > 12 && timerBefore % 4 === 0) {
      this.particles.addItemGetParticles(player.x, player.y - 24, '#fb923c');
    }

    // Landing slam at timer === 0: create Flame Wall on Changli's tile & stun enemies on same tile
    if (player.changliSkillTimer <= 0) {
      player.changliSkillTimer = 0;
      this.activeFlameWalls.push({
        ownerId: player.config.id,
        tileX: player.tileX,
        tileY: player.tileY,
        remainingFrames: 90,
      });
      sounds.playExplosion();
      this.emitSound('explosion');
      this.particles.triggerShake(5, 12);
      this.particles.addExplosionParticles(player.x, player.y, 12);
      this.particles.addItemGetParticles(player.x, player.y, '#f97316');

      this.stunEnemiesInArea(
        player.config.id,
        (other) => other.tileX === player.tileX && other.tileY === player.tileY,
        180,
        '#ef4444',
        0,
        260
      );
    }
  }

  private updateFlameWalls() {
    for (let i = this.activeFlameWalls.length - 1; i >= 0; i--) {
      const wall = this.activeFlameWalls[i];
      wall.remainingFrames--;
      this.stunEnemiesInArea(
        wall.ownerId,
        (other) => other.tileX === wall.tileX && other.tileY === wall.tileY && other.stunTimer < 165,
        180,
        '#f97316',
        0,
        200
      );
      if (wall.remainingFrames <= 0) {
        this.activeFlameWalls.splice(i, 1);
      }
    }
  }

  private updatePhoenixFlames() {
    for (let i = this.activePhoenixFlames.length - 1; i >= 0; i--) {
      const flame = this.activePhoenixFlames[i];
      flame.remainingFrames--;
      if (flame.remainingFrames % 6 === 0) {
        const cx = flame.centerTx * 48 + 24;
        const cy = flame.centerTy * 48 + 24;
        this.particles.addItemGetParticles(
          cx + (Math.random() - 0.5) * 110,
          cy + (Math.random() - 0.5) * 110,
          Math.random() < 0.5 ? '#f97316' : '#ef4444'
        );
      }
      if (flame.remainingFrames <= 0) {
        this.activePhoenixFlames.splice(i, 1);
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
    this.emitSound('kick');

    const hitPoints = [
      { x: player.x, y: player.y },
      { x: player.x + dx * 44, y: player.y + dy * 44 },
    ];

    const hitCount = this.stunEnemiesInArea(
      player.config.id,
      (other) => hitPoints.some((pt) => Math.hypot(other.x - pt.x, other.y - pt.y) < 36),
      180,
      '#facc15',
      6,
      260
    );
    if (hitCount > 0) {
      this.particles.triggerShake(4, 10);
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
      this.emitSound('wallThud');
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
      if (
        other.isAlive &&
        other.config.id !== player.config.id &&
        !player.tackleHitEnemies.has(other.config.id) &&
        !this.isProtectedFromAttack(other)
      ) {
        const dist = Math.hypot(other.x - player.x, other.y - player.y);
        if (dist < 36) {
          player.tackleHitEnemies.add(other.config.id);
          const stunDuration = player.config.ultraType === 'ULTRA_METEOR_TACKLE' && player.tackleSpeed > 5.5 ? 240 : 180;
          other.stun(stunDuration); // 3 seconds (or 4s for Meteor Tackle)
          this.particles.addItemGetParticles(other.x, other.y, '#facc15');
          this.particles.addExplosionParticles(other.x, other.y, 8);
          this.particles.triggerShake(5, 12);
          sounds.playKick();
          this.emitSound('kick');
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
    this.emitSound('wallThud');
    this.particles.triggerShake(4, 8);
    this.particles.addBlockDebris(px, py, 14);

    // Check if any player is crushed by this wall
    for (const p of this.players) {
      if (p.isAlive && p.tileX === x && p.tileY === y) {
        // Direct crush is instantly fatal regardless of shield
        p.shield = 0;
        p.hit();
        sounds.playPlayerDeath();
        this.emitSound('death');
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

    // Overlay state messages, active wind slashes, and 3x3 tempest zones
    const ctx = this.canvas.getContext('2d')!;
    this.drawWindSlashes(ctx);
    this.drawTempestZones(ctx);
    this.drawSpearStrikes(ctx);
    this.drawSanctuaryZones(ctx);
    this.drawFlameWalls(ctx);
    this.drawPhoenixFlames(ctx);

    if (this.state === 'COUNTDOWN') {
      const count = Math.ceil(this.countdownTimer / 60);
      const label = count > 0 ? `${count}` : 'BATTLE!';
      this.drawBigBanner(ctx, label, '#facc15');
    } else if (this.state === 'PLAYING' && this.overheadTagTimer > 145) {
      this.drawBigBanner(ctx, 'BATTLE!', '#facc15');
    } else if (this.state === 'ROUND_OVER') {
      const bannerText = this.roundWinner ? `${this.roundWinner.config.name} WINS!` : 'DRAW GAME!';
      const bannerColor = this.roundWinner ? this.roundWinner.config.accentColor : '#94a3b8';
      this.drawBigBanner(ctx, bannerText, bannerColor, 'Press (A) / [R] for Next Round');
    }
  }

  private drawWindSlashes(ctx: CanvasRenderingContext2D) {
    if (this.activeWindSlashes.length === 0) return;
    for (const ws of this.activeWindSlashes) {
      const angle = Math.atan2(ws.dy, ws.dx);
      ctx.save();
      ctx.translate(ws.x, ws.y);
      ctx.rotate(angle);
      ctx.lineCap = 'round';

      // Soft outer glow stroke (replaces expensive shadowBlur)
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.35)';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.arc(0, 0, 26, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();

      ctx.strokeStyle = '#2dd4bf';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, 26, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(2, 0, 24, -Math.PI * 0.35, Math.PI * 0.35);
      ctx.stroke();
      ctx.restore();
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

  private drawSpearStrikes(ctx: CanvasRenderingContext2D) {
    if (this.activeSpearStrikes.length === 0) return;
    const now = Date.now();
    for (const strike of this.activeSpearStrikes) {
      const minTx = Math.max(1, strike.centerTx - 3);
      const maxTx = Math.min(13, strike.centerTx + 3);
      const minTy = Math.max(1, strike.centerTy - 3);
      const maxTy = Math.min(11, strike.centerTy + 3);
      const left = minTx * 48;
      const top = minTy * 48;
      const width = (maxTx - minTx + 1) * 48;
      const height = (maxTy - minTy + 1) * 48;
      const cx = strike.centerTx * 48 + 24;
      const cy = strike.centerTy * 48 + 24;

      ctx.save();
      if (strike.warningFrames > 0) {
        const t = 1 - strike.warningFrames / 60; // 0 -> 1 over 1 second
        const pulse = 0.55 + 0.45 * Math.sin(now / 65);
        ctx.globalAlpha = (0.14 + t * 0.2) * pulse;
        ctx.fillStyle = '#f43f5e';
        ctx.fillRect(left, top, width, height);

        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = '#fda4af';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([10, 6]);
        ctx.lineDashOffset = -(now / 25) % 16;
        ctx.strokeRect(left + 1, top + 1, width - 2, height - 2);
        ctx.setLineDash([]);

        // Target reticle & shrinking lock-on ring at center
        const ringRadius = 18 + (1 - t) * 44;
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Falling spear shadow preview
        if (t > 0.65) {
          const dropT = (t - 0.65) / 0.35; // 0 -> 1 in last 0.35s
          const spearTipY = cy - (1 - dropT) * 260;
          this.drawGiantSpear(ctx, cx, spearTipY, 0.9);
        }
      } else {
        const fade = Math.min(1, strike.impactFrames / 18);
        // Shockwave ring across 7x7
        const waveProgress = 1 - strike.impactFrames / 36;
        ctx.globalAlpha = fade * 0.45;
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 5 * fade;
        ctx.beginPath();
        ctx.arc(cx, cy, 24 + waveProgress * 150, 0, Math.PI * 2);
        ctx.stroke();

        // Impacted giant spear
        this.drawGiantSpear(ctx, cx, cy, fade);
      }
      ctx.restore();
    }
  }

  private drawGiantSpear(ctx: CanvasRenderingContext2D, tipX: number, tipY: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    // Glowing cyan/pink spear shaft & blade pointing down at (tipX, tipY)
    ctx.fillStyle = '#e0f2fe';
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;

    // Blade
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - 18, tipY - 46);
    ctx.lineTo(tipX, tipY - 34);
    ctx.lineTo(tipX + 18, tipY - 46);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Crossguard
    ctx.fillStyle = '#f472b6';
    ctx.fillRect(tipX - 22, tipY - 52, 44, 7);

    // Shaft extending upward
    const grad = ctx.createLinearGradient(tipX - 6, tipY - 52, tipX + 6, tipY - 220);
    grad.addColorStop(0, '#38bdf8');
    grad.addColorStop(1, 'rgba(244, 114, 182, 0.15)');
    ctx.fillStyle = grad;
    ctx.fillRect(tipX - 5, tipY - 220, 10, 168);
    ctx.restore();
  }

  private drawSanctuaryZones(ctx: CanvasRenderingContext2D) {
    if (this.activeSanctuaryZones.length === 0) return;
    const now = Date.now();
    for (const zone of this.activeSanctuaryZones) {
      const { left, top, width, height, cx, cy } = this.getClampedTileBox(zone.centerTx, zone.centerTy, 2);
      const fade = Math.min(1, zone.remainingFrames / 30);
      const pulse = 0.7 + 0.3 * Math.sin(now / 160);

      ctx.save();
      ctx.globalAlpha = 0.18 * fade * pulse;
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(left, top, width, height);

      const rad = ctx.createRadialGradient(cx, cy, 12, cx, cy, Math.max(width, height) * 0.6);
      rad.addColorStop(0, 'rgba(224, 242, 254, 0.35)');
      rad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.globalAlpha = fade;
      ctx.fillStyle = rad;
      ctx.fillRect(left, top, width, height);

      ctx.globalAlpha = 0.85 * fade;
      ctx.strokeStyle = '#bae6fd';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([10, 6]);
      ctx.lineDashOffset = -(now / 35) % 16;
      ctx.strokeRect(left + 1.5, top + 1.5, width - 3, height - 3);
      ctx.setLineDash([]);

      ctx.globalAlpha = 0.55 * fade * pulse;
      ctx.strokeStyle = '#eff6ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 20 + 3 * Math.sin(now / 200), 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  private drawFlameWalls(ctx: CanvasRenderingContext2D) {
    if (this.activeFlameWalls.length === 0) return;
    const now = Date.now();
    for (const wall of this.activeFlameWalls) {
      const px = wall.tileX * 48;
      const py = wall.tileY * 48;
      const fade = Math.min(1, wall.remainingFrames / 20);
      const flicker = 0.75 + 0.25 * Math.sin(now / 55 + wall.tileX);

      ctx.save();
      ctx.globalAlpha = 0.42 * fade * flicker;
      ctx.fillStyle = '#f97316';
      ctx.fillRect(px + 2, py + 2, 44, 44);

      ctx.globalAlpha = 0.85 * fade;
      const cx = px + 24;
      const baseY = py + 42;
      const grad = ctx.createLinearGradient(cx, baseY, cx, py + 4);
      grad.addColorStop(0, '#dc2626');
      grad.addColorStop(0.55, '#f97316');
      grad.addColorStop(1, '#fef08a');
      ctx.fillStyle = grad;

      for (let k = -1; k <= 1; k++) {
        const ox = cx + k * 11;
        const h = 24 + 8 * Math.sin(now / 70 + k * 2.1);
        ctx.beginPath();
        ctx.moveTo(ox - 7, baseY);
        ctx.quadraticCurveTo(ox, baseY - h, ox + 7, baseY);
        ctx.closePath();
        ctx.fill();
      }

      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 2, py + 2, 44, 44);
      ctx.restore();
    }
  }

  private drawPhoenixFlames(ctx: CanvasRenderingContext2D) {
    if (this.activePhoenixFlames.length === 0) return;
    const now = Date.now();
    for (const flame of this.activePhoenixFlames) {
      const { left, top, width, height, cx, cy } = this.getClampedTileBox(flame.centerTx, flame.centerTy, 1);
      const fade = Math.min(1, flame.remainingFrames / 16);
      const pulse = 0.75 + 0.25 * Math.sin(now / 60);

      ctx.save();
      ctx.globalAlpha = 0.34 * fade * pulse;
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(left, top, width, height);

      const rad = ctx.createRadialGradient(cx, cy, 8, cx, cy, Math.max(width, height) * 0.65);
      rad.addColorStop(0, 'rgba(254, 240, 138, 0.75)');
      rad.addColorStop(0.5, 'rgba(249, 115, 22, 0.45)');
      rad.addColorStop(1, 'rgba(220, 38, 38, 0)');
      ctx.globalAlpha = fade;
      ctx.fillStyle = rad;
      ctx.fillRect(left, top, width, height);

      ctx.globalAlpha = 0.9 * fade;
      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 3;
      ctx.strokeRect(left + 1.5, top + 1.5, width - 3, height - 3);
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
    const textY = CANVAS_HEIGHT / 2 - (subText ? 14 : 0);

    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.strokeText(mainText, CANVAS_WIDTH / 2, textY);

    ctx.fillStyle = accentColor;
    ctx.fillText(mainText, CANVAS_WIDTH / 2, textY);

    if (subText) {
      ctx.font = 'bold 15px "Segoe UI", sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(subText, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 24);
    }

    ctx.restore();
  }

  public exportSnapshot(): GameSnapshot {
    this.snapshotCounter++;
    const includeFullGrid =
      this.map.gridVersion !== this.lastExportedGridVersion || this.snapshotCounter % 30 === 1;
    if (includeFullGrid) {
      this.lastExportedGridVersion = this.map.gridVersion;
    }

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
      grid: includeFullGrid ? this.map.grid.map((row) => [...row]) : [],
      activeItems: this.map.activeItems.map((it) => ({ ...it })),
      bombs: this.bombManager.bombs.map((b) => ({
        id: b.id,
        tileX: b.tileX,
        tileY: b.tileY,
        pixelX: Math.round(b.pixelX * 10) / 10,
        pixelY: Math.round(b.pixelY * 10) / 10,
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
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
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
        chainBombAmmo: p.chainBombAmmo,
        skillCooldownTimer: p.skillCooldownTimer,
        ultraGauge: p.ultraGauge,
        hasMegaBomb: p.hasMegaBomb,
        isTackling: p.isTackling,
        tackleSlashMode: p.tackleSlashMode,
        tackleSlashTick: p.tackleSlashTick,
        slashSequenceTimer: p.slashSequenceTimer,
        isFlying: p.isFlying,
        flightProgress: p.flightProgress,
        flightTargetX: p.flightTargetX,
        flightTargetY: p.flightTargetY,
        changliSkillTimer: p.changliSkillTimer,
        changliUltraTimer: p.changliUltraTimer,
      })),
      windSlashes: this.activeWindSlashes.map((ws) => ({
        ownerId: ws.ownerId,
        x: Math.round(ws.x * 10) / 10,
        y: Math.round(ws.y * 10) / 10,
        dx: ws.dx,
        dy: ws.dy,
        tick: ws.tick,
      })),
      tempestZones: this.activeTempestZones.map((tz) => ({ ...tz })),
      spearStrikes: this.activeSpearStrikes.map((ss) => ({ ...ss })),
      sanctuaryZones: this.activeSanctuaryZones.map((sz) => ({ ...sz })),
      flameWalls: this.activeFlameWalls.map((fw) => ({ ...fw })),
      phoenixFlames: this.activePhoenixFlames.map((pf) => ({ ...pf })),
      fxEvents: this.isOnlineHost ? this.particles.consumePendingFxEvents() : [],
      playerSlots: this.playerSlots.map((s) => ({ ...s })),
      itemSettings: { ...this.itemSettings },
    };
  }

  public applySnapshot(snap: GameSnapshot) {
    if (!snap) return;

    if (snap.itemSettings) {
      this.itemSettings = { ...snap.itemSettings };
    }

    if (snap.playerSlots && snap.playerSlots.length > 0) {
      const slotsChanged =
        this.playerSlots.length !== snap.playerSlots.length ||
        this.players.length === 0 ||
        snap.playerSlots.some((s, i) => {
          const cur = this.playerSlots[i];
          return !cur || cur.charId !== s.charId || cur.control !== s.control;
        });
      if (slotsChanged) {
        this.playerSlots = snap.playerSlots.map((s) => ({ ...s }));
        this.setupPlayers();
      }
    } else if (this.players.length === 0) {
      this.setupPlayers();
    }

    const prevState = this.state;
    const prevCountSec = Math.ceil(this.countdownTimer / 60);
    const nextCountSec = Math.ceil(snap.countdownTimer / 60);

    if (snap.state === 'COUNTDOWN' && nextCountSec > 0) {
      if (prevState !== 'COUNTDOWN' || nextCountSec !== prevCountSec) {
        sounds.playCountdownTick();
      }
    } else if (prevState === 'COUNTDOWN' && snap.state === 'PLAYING') {
      sounds.playBattleStart();
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
      let gridDiff = this.map.grid.length !== snap.grid.length;
      if (!gridDiff) {
        outer: for (let y = 0; y < snap.grid.length; y++) {
          const curRow = this.map.grid[y];
          const newRow = snap.grid[y];
          if (!curRow || curRow.length !== newRow.length) {
            gridDiff = true;
            break;
          }
          for (let x = 0; x < newRow.length; x++) {
            if (curRow[x] !== newRow[x]) {
              gridDiff = true;
              break outer;
            }
          }
        }
      }
      if (gridDiff) {
        this.map.grid = snap.grid.map((row) => [...row]);
        this.map.gridVersion++;
      }
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
        p.chainBombAmmo = sp.chainBombAmmo ?? 0;
        p.skillCooldownTimer = sp.skillCooldownTimer;
        p.ultraGauge = sp.ultraGauge;
        p.hasMegaBomb = sp.hasMegaBomb;
        p.isTackling = sp.isTackling;
        p.tackleSlashMode = sp.tackleSlashMode;
        p.tackleSlashTick = sp.tackleSlashTick;
        p.slashSequenceTimer = sp.slashSequenceTimer;
        p.isFlying = sp.isFlying ?? false;
        p.flightProgress = sp.flightProgress ?? 0;
        p.flightTargetX = sp.flightTargetX ?? p.x;
        p.flightTargetY = sp.flightTargetY ?? p.y;
        p.changliSkillTimer = sp.changliSkillTimer ?? 0;
        p.changliUltraTimer = sp.changliUltraTimer ?? 0;
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
    if (snap.spearStrikes) {
      this.activeSpearStrikes = snap.spearStrikes.map((ss) => ({ ...ss }));
    }
    if (snap.sanctuaryZones) {
      this.activeSanctuaryZones = snap.sanctuaryZones.map((sz) => ({ ...sz }));
    }
    if (snap.flameWalls) {
      this.activeFlameWalls = snap.flameWalls.map((fw) => ({ ...fw }));
    }
    if (snap.phoenixFlames) {
      this.activePhoenixFlames = snap.phoenixFlames.map((pf) => ({ ...pf }));
    }

    if (snap.fxEvents && snap.fxEvents.length > 0) {
      this.particles.replayFxEvents(snap.fxEvents);
    }

    this.broadcastStats();
  }
}
