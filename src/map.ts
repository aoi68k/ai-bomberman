// Map, Grid, and Item Management for AI-Bomberman

import {
  COLS,
  ROWS,
  TILE_SIZE,
  TILE,
  TileType,
  ITEM,
  ItemType,
  ItemData,
  SPAWN_SAFE_ZONES,
  ItemSettings,
  DEFAULT_ITEM_SETTINGS,
} from './constants';

export class GameMap {
  public grid: TileType[][] = [];
  public gridVersion: number = 0;
  public hiddenItems: Map<string, ItemType> = new Map(); // key: "x,y"
  public activeItems: ItemData[] = [];
  private nextItemId: number = 1;

  constructor() {
    this.reset();
  }

  public reset(softBlockRatio: number = 0.65, itemSettings: ItemSettings = DEFAULT_ITEM_SETTINGS) {
    this.grid = [];
    this.gridVersion++;
    this.hiddenItems.clear();
    this.activeItems = [];
    this.nextItemId = 1;

    // Create safe zone lookup
    const safeSet = new Set<string>();
    for (const s of SPAWN_SAFE_ZONES) {
      safeSet.add(`${s.x},${s.y}`);
    }

    for (let y = 0; y < ROWS; y++) {
      const row: TileType[] = [];
      for (let x = 0; x < COLS; x++) {
        // Outer boundaries
        if (x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1) {
          row.push(TILE.WALL);
          continue;
        }

        // Inner indestructible grid pillars
        if (x % 2 === 0 && y % 2 === 0) {
          row.push(TILE.WALL);
          continue;
        }

        // Spawn safety corners (players start here, cannot have blocks)
        if (safeSet.has(`${x},${y}`)) {
          row.push(TILE.EMPTY);
          continue;
        }

        // Destructible soft blocks
        if (Math.random() < softBlockRatio) {
          row.push(TILE.SOFT_BLOCK);

          // Decide item drop inside this soft block
          if (Math.random() < 0.45) {
            const item = this.randomItemType(itemSettings);
            this.hiddenItems.set(`${x},${y}`, item);
          }
        } else {
          row.push(TILE.EMPTY);
        }
      }
      this.grid.push(row);
    }
  }

  private randomItemType(settings: ItemSettings): ItemType {
    const pool: { type: ItemType; weight: number }[] = [
      { type: ITEM.FIRE_UP, weight: 26 },
      { type: ITEM.BOMB_UP, weight: 26 },
      { type: ITEM.SPEED_UP, weight: 22 },
      { type: ITEM.KICK, weight: 14 },
    ];
    if (settings.shield) {
      pool.push({ type: ITEM.SHIELD, weight: 10 });
    }
    if (settings.chainBomb) {
      pool.push({ type: ITEM.CHAIN_BOMB, weight: 12 });
    }
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * total;
    for (const item of pool) {
      if (roll < item.weight) return item.type;
      roll -= item.weight;
    }
    return ITEM.BOMB_UP;
  }

  public getTile(x: number, y: number): TileType {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) {
      return TILE.WALL;
    }
    return this.grid[y][x];
  }

  public setTile(x: number, y: number, tile: TileType) {
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) {
      if (this.grid[y][x] !== tile) {
        this.grid[y][x] = tile;
        this.gridVersion++;
      }
    }
  }

  public isWalkable(x: number, y: number): boolean {
    return this.getTile(x, y) === TILE.EMPTY;
  }

  /**
   * Called when an explosion destroys a soft block at (x, y)
   * Returns item type if one was dropped, or null
   */
  public destroySoftBlock(x: number, y: number): ItemType | null {
    if (this.getTile(x, y) !== TILE.SOFT_BLOCK) return null;

    this.setTile(x, y, TILE.EMPTY);
    const itemType = this.hiddenItems.get(`${x},${y}`);
    if (itemType) {
      this.hiddenItems.delete(`${x},${y}`);
      const newItem: ItemData = {
        id: this.nextItemId++,
        tileX: x,
        tileY: y,
        type: itemType,
        spawnTime: Date.now(),
      };
      this.activeItems.push(newItem);
      return itemType;
    }
    return null;
  }

  /**
   * Destroys an active item if touched by fire/explosion
   */
  public burnItemAt(x: number, y: number): boolean {
    const idx = this.activeItems.findIndex((it) => it.tileX === x && it.tileY === y);
    if (idx !== -1) {
      this.activeItems.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Picks up item at tile (x, y) if exists
   */
  public pickupItemAt(x: number, y: number): ItemType | null {
    const idx = this.activeItems.findIndex((it) => it.tileX === x && it.tileY === y);
    if (idx !== -1) {
      const item = this.activeItems[idx];
      this.activeItems.splice(idx, 1);
      return item.type;
    }
    return null;
  }

  public getItemAt(x: number, y: number): ItemData | undefined {
    return this.activeItems.find((it) => it.tileX === x && it.tileY === y);
  }
}
