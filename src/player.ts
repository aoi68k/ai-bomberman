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

  // Skill state
  public skillCooldownTimer: number = 0; // Cooldown frames remaining
  public hasMegaBomb: boolean = false; // Next bomb will be mega bomb
  public lastPlacedBombId: number | null = null; // For remote detonate

  public isAlive: boolean = true;
  public deathTimer: number = 0; // For death spin animation

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
    this.speed = INITIAL_PLAYER_SPEED;
    this.maxBombs = INITIAL_BOMBS;
    this.activeBombs = 0;
    this.power = INITIAL_POWER;
    this.hasKick = false;
    this.shield = 0;
    this.skillCooldownTimer = 0;
    this.hasMegaBomb = false;
    this.lastPlacedBombId = null;
    this.isAlive = true;
    this.deathTimer = 0;
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
    }
  }

  /**
   * Checks if a point collides with walls or non-passable bombs
   */
  private isColliding(checkX: number, checkY: number, map: GameMap, bombManager: BombManager): boolean {
    const r = PLAYER_HITBOX_RADIUS;
    const points = [
      { x: checkX - r, y: checkY - r },
      { x: checkX + r, y: checkY - r },
      { x: checkX - r, y: checkY + r },
      { x: checkX + r, y: checkY + r },
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
   * Core movement with cornering / sliding assist for classic Bomberman feel
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

    // --- CORNERING ASSIST (Wall Sliding) ---
    // If moving horizontally, assist vertical alignment towards tile center
    // If moving vertically, assist horizontal alignment towards tile center
    const tileCenterX = this.tileX * TILE_SIZE + TILE_SIZE / 2;
    const tileCenterY = this.tileY * TILE_SIZE + TILE_SIZE / 2;

    if (inputDx !== 0 && inputDy === 0) {
      const diffY = this.y - tileCenterY;
      // If we are slightly misaligned with tile center and moving forward hits a wall,
      // nudge towards the tile center so player smoothly turns into hallways!
      if (Math.abs(diffY) > 2 && Math.abs(diffY) < CORNERING_ASSIST_THRESHOLD) {
        const testNextX = this.x + moveX;
        if (this.isColliding(testNextX, this.y, map, bombManager)) {
          const nudgeY = -Math.sign(diffY) * Math.min(Math.abs(diffY), this.speed * 0.9);
          if (!this.isColliding(this.x, this.y + nudgeY, map, bombManager)) {
            this.y += nudgeY;
          }
        }
      }
    } else if (inputDy !== 0 && inputDx === 0) {
      const diffX = this.x - tileCenterX;
      if (Math.abs(diffX) > 2 && Math.abs(diffX) < CORNERING_ASSIST_THRESHOLD) {
        const testNextY = this.y + moveY;
        if (this.isColliding(this.x, testNextY, map, bombManager)) {
          const nudgeX = -Math.sign(diffX) * Math.min(Math.abs(diffX), this.speed * 0.9);
          if (!this.isColliding(this.x + nudgeX, this.y, map, bombManager)) {
            this.x += nudgeX;
          }
        }
      }
    }

    // Try moving X axis
    if (moveX !== 0) {
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

    // Try moving Y axis
    if (moveY !== 0) {
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

    this.isAlive = false;
    this.deathTimer = 60;
    return true;
  }
}
