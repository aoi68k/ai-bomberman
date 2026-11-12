// Bomb and Explosion entities and mechanics

import {
  COLS,
  ROWS,
  TILE_SIZE,
  TILE,
  BOMB_FUSE_TIME,
  EXPLOSION_DURATION,
  BOMB_SLIDE_SPEED,
} from './constants';
import { GameMap } from './map';

export interface ExplosionCell {
  tileX: number;
  tileY: number;
  direction: 'center' | 'up' | 'down' | 'left' | 'right';
  isEnd: boolean;
  life: number;
  maxLife: number;
}

export class ExplosionManager {
  public cells: ExplosionCell[] = [];

  public addExplosion(
    originX: number,
    originY: number,
    power: number,
    map: GameMap,
    onTriggerBomb: (x: number, y: number) => void,
    onBlockDestroyed?: (x: number, y: number) => void
  ) {
    // 1. Center cell
    this.cells.push({
      tileX: originX,
      tileY: originY,
      direction: 'center',
      isEnd: false,
      life: EXPLOSION_DURATION,
      maxLife: EXPLOSION_DURATION,
    });
    map.burnItemAt(originX, originY);

    // 2. Rays in 4 directions
    const dirs: Array<{ dx: number; dy: number; dir: 'up' | 'down' | 'left' | 'right' }> = [
      { dx: 0, dy: -1, dir: 'up' },
      { dx: 0, dy: 1, dir: 'down' },
      { dx: -1, dy: 0, dir: 'left' },
      { dx: 1, dy: 0, dir: 'right' },
    ];

    for (const { dx, dy, dir } of dirs) {
      for (let dist = 1; dist <= power; dist++) {
        const tx = originX + dx * dist;
        const ty = originY + dy * dist;

        // Out of bounds
        if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) break;

        const tile = map.getTile(tx, ty);

        // Wall: Stop immediately (no fire inside wall)
        if (tile === TILE.WALL) {
          break;
        }

        // Soft Block: Destroy block, add explosion cell here, and stop the ray
        if (tile === TILE.SOFT_BLOCK) {
          map.destroySoftBlock(tx, ty);
          if (onBlockDestroyed) onBlockDestroyed(tx, ty);
          this.cells.push({
            tileX: tx,
            tileY: ty,
            direction: dir,
            isEnd: true,
            life: EXPLOSION_DURATION,
            maxLife: EXPLOSION_DURATION,
          });
          break;
        }

        // Check if there is another bomb at (tx, ty) to trigger chain explosion
        onTriggerBomb(tx, ty);

        // Burn any item on this tile
        map.burnItemAt(tx, ty);

        const isLast = dist === power;
        this.cells.push({
          tileX: tx,
          tileY: ty,
          direction: dir,
          isEnd: isLast,
          life: EXPLOSION_DURATION,
          maxLife: EXPLOSION_DURATION,
        });
      }
    }
  }

  public update() {
    for (let i = this.cells.length - 1; i >= 0; i--) {
      this.cells[i].life--;
      if (this.cells[i].life <= 0) {
        this.cells.splice(i, 1);
      }
    }
  }

  public isCellDangerous(x: number, y: number): boolean {
    return this.cells.some((c) => c.tileX === x && c.tileY === y);
  }

  public clear() {
    this.cells = [];
  }
}

export class Bomb {
  public id: number;
  public ownerId: number;
  public tileX: number;
  public tileY: number;
  public pixelX: number;
  public pixelY: number;
  public power: number;
  public timer: number; // Ticks down from BOMB_FUSE_TIME
  public isSliding: boolean = false;
  public slideDx: number = 0;
  public slideDy: number = 0;
  public passablePlayers: Set<number> = new Set(); // Players still inside tile when placed

  constructor(id: number, ownerId: number, tileX: number, tileY: number, power: number) {
    this.id = id;
    this.ownerId = ownerId;
    this.tileX = tileX;
    this.tileY = tileY;
    this.pixelX = tileX * TILE_SIZE + TILE_SIZE / 2;
    this.pixelY = tileY * TILE_SIZE + TILE_SIZE / 2;
    this.power = power;
    this.timer = BOMB_FUSE_TIME;
    this.passablePlayers.add(ownerId);
  }

  public kick(dx: number, dy: number) {
    this.isSliding = true;
    this.slideDx = dx;
    this.slideDy = dy;
    this.passablePlayers.clear(); // Once kicked, cannot be passed through
  }

  public stopSliding() {
    this.isSliding = false;
    this.slideDx = 0;
    this.slideDy = 0;
    // Snap to nearest tile center
    this.tileX = Math.round((this.pixelX - TILE_SIZE / 2) / TILE_SIZE);
    this.tileY = Math.round((this.pixelY - TILE_SIZE / 2) / TILE_SIZE);
    this.pixelX = this.tileX * TILE_SIZE + TILE_SIZE / 2;
    this.pixelY = this.tileY * TILE_SIZE + TILE_SIZE / 2;
  }
}

export class BombManager {
  public bombs: Bomb[] = [];
  public explosions: ExplosionManager = new ExplosionManager();
  private nextBombId: number = 1;

  public reset() {
    this.bombs = [];
    this.explosions.clear();
    this.nextBombId = 1;
  }

  public placeBomb(
    ownerId: number,
    tileX: number,
    tileY: number,
    power: number,
    allPlayersInTile: number[]
  ): Bomb | null {
    // Check if tile already has a bomb
    if (this.getBombAt(tileX, tileY)) {
      return null;
    }

    const bomb = new Bomb(this.nextBombId++, ownerId, tileX, tileY, power);
    // Any player overlapping this tile can still exit without getting trapped immediately
    for (const pid of allPlayersInTile) {
      bomb.passablePlayers.add(pid);
    }
    this.bombs.push(bomb);
    return bomb;
  }

  public getBombAt(x: number, y: number): Bomb | undefined {
    return this.bombs.find((b) => b.tileX === x && b.tileY === y);
  }

  public getBombAtPixel(px: number, py: number): Bomb | undefined {
    return this.bombs.find((b) => {
      const dist = Math.hypot(b.pixelX - px, b.pixelY - py);
      return dist < TILE_SIZE * 0.45;
    });
  }

  public update(
    map: GameMap,
    onExplode: (bomb: Bomb) => void,
    onBlockDestroyed?: (x: number, y: number) => void
  ) {
    // 1. Update explosions
    this.explosions.update();

    // 2. Update bombs
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i];

      // Handle sliding
      if (bomb.isSliding) {
        const nextX = bomb.pixelX + bomb.slideDx * BOMB_SLIDE_SPEED;
        const nextY = bomb.pixelY + bomb.slideDy * BOMB_SLIDE_SPEED;

        // Target tile ahead
        const checkTileX = Math.floor((nextX + bomb.slideDx * (TILE_SIZE * 0.45)) / TILE_SIZE);
        const checkTileY = Math.floor((nextY + bomb.slideDy * (TILE_SIZE * 0.45)) / TILE_SIZE);

        const tileBlocked = !map.isWalkable(checkTileX, checkTileY);
        const anotherBomb = this.bombs.some(
          (other) => other.id !== bomb.id && other.tileX === checkTileX && other.tileY === checkTileY
        );

        if (tileBlocked || anotherBomb) {
          bomb.stopSliding();
        } else {
          bomb.pixelX = nextX;
          bomb.pixelY = nextY;
          bomb.tileX = Math.round((bomb.pixelX - TILE_SIZE / 2) / TILE_SIZE);
          bomb.tileY = Math.round((bomb.pixelY - TILE_SIZE / 2) / TILE_SIZE);
        }
      }

      // Decrement fuse timer
      bomb.timer--;

      if (bomb.timer <= 0) {
        // Explode this bomb
        this.bombs.splice(i, 1);
        onExplode(bomb);

        this.explosions.addExplosion(
          bomb.tileX,
          bomb.tileY,
          bomb.power,
          map,
          (chainX, chainY) => {
            // Trigger chain explosion for any bomb on this tile
            const chainBomb = this.bombs.find((b) => b.tileX === chainX && b.tileY === chainY);
            if (chainBomb && chainBomb.timer > 2) {
              chainBomb.timer = 2; // Trigger almost instantly
            }
          },
          onBlockDestroyed
        );
      }
    }
  }
}
