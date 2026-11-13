// Player logic, movement with cornering assist, collision, and state

import {
  TILE_SIZE,
  PLAYER_HITBOX_RADIUS,
  INITIAL_PLAYER_SPEED,
  MAX_PLAYER_SPEED,
  SPEED_INCREMENT,
  INITIAL_BOMBS,
  MAX_BOMBS,
  INITIAL_POWER,
  MAX_POWER,
  CORNERING_ASSIST_THRESHOLD,
  ITEM,
  ItemType,
  PlayerConfig,
} from './constants';
import { GameMap } from './map';
import { BombManager, Bomb } from './bomb';

export class Player {
  public config: PlayerConfig;
  public x: number;
  public y: number;
  public vx: number = 0;
  public vy: number = 0;
  public speed: number = INITIAL_PLAYER_SPEED;

  public maxBombs: number = INITIAL_BOMBS;
  public activeBombs: number = 0;
  public power: number = INITIAL_POWER;
  public hasKick: boolean = false;
  public shield: number = 0; // Number of hits shielded
  public chainBombAmmo: number = 0; // Number of chain bomb skill uses remaining

  // Skill state
  public skillCooldownTimer: number = 0; // Cooldown frames remaining
  public ultraCooldownTimer: number = 0; // Legacy cooldown frames (unused under gauge system)
  public ultraGauge: number = 0; // Ultra gauge: +1 per bomb placed, 10 = ready to use ultra once
  public hasMegaBomb: boolean = false; // Next bomb will be mega bomb
  public lastPlacedBombId: number | null = null; // For remote detonate

  // Tackle / Rush state (Bomber Purple & Chen)
  public isTackling: boolean = false;
  public tackleDx: number = 0;
  public tackleDy: number = 0;
  public tackleRemainingDist: number = 0;
  public tackleSpeed: number = 5.0; // Moderate, readable rush speed
  public tackleStopOnHit: boolean = true;
  public tackleSlashMode: 'none' | 'skill_rush' | 'ultra_tempest' = 'none';
  public tackleSlashTick: number = 0;
  public tackleHitEnemies: Set<number> = new Set();

  // Chen's 2-slash windup sequence before rushing
  public slashSequenceTimer: number = 0;
  public slashSeqDx: number = 0;
  public slashSeqDy: number = 0;

  public isAlive: boolean = true;
  public deathTimer: number = 0; // For death spin animation
  public stunTimer: number = 0; // Stun duration in frames (stars over head, cannot act)

  public facing: 'up' | 'down' | 'left' | 'right' = 'down';
  public animFrame: number = 0;
  public isMoving: boolean = false;
  public invulnerableTimer: number = 0;

  constructor(config: PlayerConfig) {
    this.config = config;
    this.x = config.spawnTileX * TILE_SIZE + TILE_SIZE / 2;
    this.y = config.spawnTileY * TILE_SIZE + TILE_SIZE / 2;
    this.reset();
  }

  public reset() {
    this.x = this.config.spawnTileX * TILE_SIZE + TILE_SIZE / 2;
    this.y = this.config.spawnTileY * TILE_SIZE + TILE_SIZE / 2;
    this.vx = 0;
    this.vy = 0;
    this.speed = this.config.stats?.initialSpeed ?? INITIAL_PLAYER_SPEED;
    this.maxBombs = this.config.stats?.initialBombs ?? INITIAL_BOMBS;
    this.activeBombs = 0;
    this.power = this.config.stats?.initialPower ?? INITIAL_POWER;
    this.hasKick = false;
    this.shield = 0;
    this.chainBombAmmo = 0;
    this.skillCooldownTimer = 0;
    this.ultraCooldownTimer = 0;
    this.ultraGauge = 0;
    this.hasMegaBomb = false;
    this.lastPlacedBombId = null;
    this.isTackling = false;
    this.tackleDx = 0;
    this.tackleDy = 0;
    this.tackleRemainingDist = 0;
    this.tackleSpeed = 5.0;
    this.tackleStopOnHit = true;
    this.tackleSlashMode = 'none';
    this.tackleSlashTick = 0;
    this.tackleHitEnemies.clear();
    this.slashSequenceTimer = 0;
    this.slashSeqDx = 0;
    this.slashSeqDy = 0;
    this.isAlive = true;
    this.deathTimer = 0;
    this.stunTimer = 0;
    this.facing = this.config.spawnTileY < 6 ? 'down' : 'up';
    this.animFrame = 0;
    this.isMoving = false;
    this.invulnerableTimer = 0;
  }

  public get tileX(): number {
    return Math.floor(this.x / TILE_SIZE);
  }

  public get tileY(): number {
    return Math.floor(this.y / TILE_SIZE);
  }

  /**
   * Applies an acquired powerup item
   */
  public applyItem(type: ItemType) {
    switch (type) {
      case ITEM.BOMB_UP:
        if (this.maxBombs < MAX_BOMBS) this.maxBombs++;
        break;
      case ITEM.FIRE_UP:
        if (this.power < MAX_POWER) this.power++;
        break;
      case ITEM.SPEED_UP:
        if (this.speed < MAX_PLAYER_SPEED) this.speed += SPEED_INCREMENT;
        break;
      case ITEM.KICK:
        this.hasKick = true;
        break;
      case ITEM.SHIELD:
        this.shield = Math.min(this.shield + 1, 2);
        break;
      case ITEM.CHAIN_BOMB:
        this.chainBombAmmo = Math.min(this.chainBombAmmo + 3, 6);
        break;
    }
  }

  /**
   * Checks if a point collides with walls or non-passable bombs.
   * Uses an 8-point chamfered bounding box so players don't snag on microscopic corner pixels.
   */
  public isColliding(checkX: number, checkY: number, map: GameMap, bombManager: BombManager): boolean {
    const r = PLAYER_HITBOX_RADIUS;
    const c = 3.0; // Corner chamfer offset (3px) prevents snagging on sharp corner edges

    const points = [
      // Top and bottom edges (slightly inset from corners)
      { x: checkX - r + c, y: checkY - r },
      { x: checkX + r - c, y: checkY - r },
      { x: checkX - r + c, y: checkY + r },
      { x: checkX + r - c, y: checkY + r },
      // Left and right edges (slightly inset from corners)
      { x: checkX - r, y: checkY - r + c },
      { x: checkX - r, y: checkY + r - c },
      { x: checkX + r, y: checkY - r + c },
      { x: checkX + r, y: checkY + r - c },
    ];

    for (const pt of points) {
      const tx = Math.floor(pt.x / TILE_SIZE);
      const ty = Math.floor(pt.y / TILE_SIZE);

      // Map barrier
      if (!map.isWalkable(tx, ty)) {
        return true;
      }

      // Bomb obstacle
      const bomb = bombManager.getBombAt(tx, ty);
      if (bomb) {
        // If player is not currently allowed to pass through this bomb
        if (!bomb.passablePlayers.has(this.config.id)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Helper to check if a tile is walkable and not blocked by a solid bomb
   */
  private isTilePassable(tx: number, ty: number, map: GameMap, bombManager: BombManager): boolean {
    if (!map.isWalkable(tx, ty)) return false;
    const bomb = bombManager.getBombAt(tx, ty);
    if (bomb && !bomb.passablePlayers.has(this.config.id)) return false;
    return true;
  }

  /**
   * Core movement with smart cornering / sliding assist for classic Bomberman feel
   */
  public move(
    inputDx: number,
    inputDy: number,
    map: GameMap,
    bombManager: BombManager,
    onKickBomb?: (bomb: Bomb) => void
  ) {
    if (!this.isAlive) return;

    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer--;
    }

    // Stunned state: immobilized, cannot move or act
    if (this.stunTimer > 0) {
      this.stunTimer--;
      this.isMoving = false;
      this.isTackling = false;
      return;
    }

    // Tackling rush: automated charge, ignore directional input
    if (this.isTackling) {
      return;
    }

    if (inputDx === 0 && inputDy === 0) {
      this.isMoving = false;
      return;
    }

    this.isMoving = true;
    this.animFrame++;

    // Determine facing
    if (Math.abs(inputDx) > Math.abs(inputDy)) {
      this.facing = inputDx > 0 ? 'right' : 'left';
    } else if (inputDy !== 0) {
      this.facing = inputDy > 0 ? 'down' : 'up';
    }

    // Attempted movement amounts
    let moveX = inputDx * this.speed;
    let moveY = inputDy * this.speed;

    let assistedX = false;
    let assistedY = false;

    // --- SMART CORNERING ASSIST (Turning at Crossroads & Wall Sliding) ---
    // 1. Horizontal movement assist: if player wants to move horizontally but is blocked,
    // look for an open crossroad turn or hallway center within CORNERING_ASSIST_THRESHOLD
    if (inputDx !== 0) {
      const testNextX = this.x + moveX;
      if (this.isColliding(testNextX, this.y, map, bombManager)) {
        const nextTx = this.tileX + Math.sign(inputDx);
        const candidateRows = [this.tileY, this.tileY - 1, this.tileY + 1];

        let bestCandidateY: number | null = null;
        let bestDistY = Infinity;

        for (const candTy of candidateRows) {
          if (
            this.isTilePassable(nextTx, candTy, map, bombManager) &&
            this.isTilePassable(this.tileX, candTy, map, bombManager)
          ) {
            const centerY = candTy * TILE_SIZE + TILE_SIZE / 2;
            const dist = Math.abs(this.y - centerY);
            if (dist < bestDistY) {
              bestDistY = dist;
              bestCandidateY = centerY;
            }
          }
        }

        if (bestCandidateY !== null && bestDistY <= CORNERING_ASSIST_THRESHOLD && bestDistY > 0.5) {
          const diffY = this.y - bestCandidateY;
          const nudgeY = -Math.sign(diffY) * Math.min(Math.abs(diffY), this.speed);
          if (!this.isColliding(this.x, this.y + nudgeY, map, bombManager)) {
            this.y += nudgeY;
            assistedY = true;
          }
        }
      }
    }

    // 2. Vertical movement assist: if player wants to move vertically but is blocked,
    // look for an open crossroad turn or hallway center within CORNERING_ASSIST_THRESHOLD
    if (inputDy !== 0) {
      const testNextY = this.y + moveY;
      if (this.isColliding(this.x, testNextY, map, bombManager)) {
        const nextTy = this.tileY + Math.sign(inputDy);
        const candidateCols = [this.tileX, this.tileX - 1, this.tileX + 1];

        let bestCandidateX: number | null = null;
        let bestDistX = Infinity;

        for (const candTx of candidateCols) {
          if (
            this.isTilePassable(candTx, nextTy, map, bombManager) &&
            this.isTilePassable(candTx, this.tileY, map, bombManager)
          ) {
            const centerX = candTx * TILE_SIZE + TILE_SIZE / 2;
            const dist = Math.abs(this.x - centerX);
            if (dist < bestDistX) {
              bestDistX = dist;
              bestCandidateX = centerX;
            }
          }
        }

        if (bestCandidateX !== null && bestDistX <= CORNERING_ASSIST_THRESHOLD && bestDistX > 0.5) {
          const diffX = this.x - bestCandidateX;
          const nudgeX = -Math.sign(diffX) * Math.min(Math.abs(diffX), this.speed);
          if (!this.isColliding(this.x + nudgeX, this.y, map, bombManager)) {
            this.x += nudgeX;
            assistedX = true;
          }
        }
      }
    }

    // Try moving X axis (skip if already guided vertically around corner)
    if (moveX !== 0 && !assistedX) {
      if (!this.isColliding(this.x + moveX, this.y, map, bombManager)) {
        this.x += moveX;
      } else {
        // Check bomb kicking in X direction
        if (this.hasKick) {
          const kickTargetTx = Math.floor((this.x + Math.sign(moveX) * (PLAYER_HITBOX_RADIUS + 8)) / TILE_SIZE);
          const kickTargetTy = this.tileY;
          const kickBomb = bombManager.getBombAt(kickTargetTx, kickTargetTy);
          if (kickBomb && !kickBomb.isSliding) {
            kickBomb.kick(Math.sign(moveX), 0);
            if (onKickBomb) onKickBomb(kickBomb);
          }
        }
      }
    }

    // Try moving Y axis (skip if already guided horizontally around corner)
    if (moveY !== 0 && !assistedY) {
      if (!this.isColliding(this.x, this.y + moveY, map, bombManager)) {
        this.y += moveY;
      } else {
        // Check bomb kicking in Y direction
        if (this.hasKick) {
          const kickTargetTx = this.tileX;
          const kickTargetTy = Math.floor((this.y + Math.sign(moveY) * (PLAYER_HITBOX_RADIUS + 8)) / TILE_SIZE);
          const kickBomb = bombManager.getBombAt(kickTargetTx, kickTargetTy);
          if (kickBomb && !kickBomb.isSliding) {
            kickBomb.kick(0, Math.sign(moveY));
            if (onKickBomb) onKickBomb(kickBomb);
          }
        }
      }
    }

    // Check passable bombs: if player completely left a bomb's tile, revoke passability
    for (const bomb of bombManager.bombs) {
      if (bomb.passablePlayers.has(this.config.id)) {
        const dist = Math.hypot(bomb.pixelX - this.x, bomb.pixelY - this.y);
        // Once player center is far enough outside the tile, make it solid
        if (dist > TILE_SIZE * 0.85) {
          bomb.passablePlayers.delete(this.config.id);
        }
      }
    }
  }

  /**
   * Applies damage to player. Returns true if fatal.
   */
  public hit(): boolean {
    if (!this.isAlive) return false;
    if (this.invulnerableTimer > 0) return false;

    if (this.shield > 0) {
      this.shield--;
      this.invulnerableTimer = 60; // 1 second invulnerability
      return false;
    }

    this.cancelTackle();
    this.isAlive = false;
    this.deathTimer = 60;
    return true;
  }

  /**
   * Applies stun to player for a duration in frames (default 180 frames = 3 seconds)
   */
  public stun(frames: number = 180) {
    if (!this.isAlive) return;
    this.cancelTackle();
    this.stunTimer = Math.max(this.stunTimer, frames);
    this.isMoving = false;
  }

  /**
   * Starts a tackle or slash rush in the specified direction
   */
  public startTackle(
    dx: number,
    dy: number,
    distance: number = 96,
    speed: number = 5.0,
    stopOnHit: boolean = true,
    slashMode: 'none' | 'skill_rush' | 'ultra_tempest' = 'none'
  ) {
    this.isTackling = true;
    this.tackleDx = dx;
    this.tackleDy = dy;
    this.tackleRemainingDist = distance;
    this.tackleSpeed = speed;
    this.tackleStopOnHit = stopOnHit;
    this.tackleSlashMode = slashMode;
    this.tackleSlashTick = 0;
    this.tackleHitEnemies.clear();

    // Corridor alignment: snap perpendicular axis to center of tile
    if (dx !== 0) {
      this.y = this.tileY * TILE_SIZE + TILE_SIZE / 2;
      this.facing = dx > 0 ? 'right' : 'left';
    } else if (dy !== 0) {
      this.x = this.tileX * TILE_SIZE + TILE_SIZE / 2;
      this.facing = dy > 0 ? 'down' : 'up';
    }
  }

  /**
   * Stops active tackle / slash sequence immediately
   */
  public cancelTackle() {
    this.isTackling = false;
    this.tackleRemainingDist = 0;
    this.tackleSlashMode = 'none';
    this.tackleSlashTick = 0;
    this.tackleHitEnemies.clear();
    this.slashSequenceTimer = 0;
  }
}
