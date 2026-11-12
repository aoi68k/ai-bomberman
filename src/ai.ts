// Advanced AI Brain for COM Opponents in AI-Bomberman

import { COLS, ROWS, TILE, TILE_SIZE } from './constants';
import { GameMap } from './map';
import { BombManager, Bomb } from './bomb';
import { Player } from './player';

interface TileCoord {
  x: number;
  y: number;
}

export class AIController {
  private player: Player;
  private currentPath: TileCoord[] = [];
  private reevaluateTimer: number = 0;
  private lastTileX: number = -1;
  private lastTileY: number = -1;
  private stuckCounter: number = 0;

  constructor(player: Player) {
    this.player = player;
  }

  /**
   * Generates a 2D danger map:
   * 0 = Safe
   * > 0 = Danger (approx. frames until explosion hits this tile, or already exploding)
   */
  public static calculateDangerMap(map: GameMap, bombManager: BombManager): number[][] {
    const danger: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));

    // 1. Mark existing active explosion flames as immediate danger
    for (const cell of bombManager.explosions.cells) {
      if (cell.tileX >= 0 && cell.tileX < COLS && cell.tileY >= 0 && cell.tileY < ROWS) {
        danger[cell.tileY][cell.tileX] = 1; // Immediate danger
      }
    }

    // 2. Mark bomb blast areas
    for (const bomb of bombManager.bombs) {
      const bx = bomb.tileX;
      const by = bomb.tileY;
      const timeLeft = Math.max(2, bomb.timer);

      // Bomb tile itself is dangerous
      danger[by][bx] = danger[by][bx] === 0 ? timeLeft : Math.min(danger[by][bx], timeLeft);

      // Raycast in 4 directions
      const dirs = [
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
      ];

      for (const { dx, dy } of dirs) {
        for (let dist = 1; dist <= bomb.power; dist++) {
          const tx = bx + dx * dist;
          const ty = by + dy * dist;

          if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) break;

          const tile = map.getTile(tx, ty);
          if (tile === TILE.WALL) break; // Hard wall blocks blast completely

          danger[ty][tx] = danger[ty][tx] === 0 ? timeLeft : Math.min(danger[ty][tx], timeLeft);

          if (tile === TILE.SOFT_BLOCK) break; // Soft block blocks rest of the ray
        }
      }
    }

    return danger;
  }

  /**
   * Main AI decision cycle run every frame
   */
  public update(
    map: GameMap,
    bombManager: BombManager,
    allPlayers: Player[],
    requestPlaceBomb: (player: Player) => boolean
  ) {
    if (!this.player.isAlive) return;

    this.reevaluateTimer--;

    const myTx = this.player.tileX;
    const myTy = this.player.tileY;

    // Check stuck detection
    if (myTx === this.lastTileX && myTy === this.lastTileY) {
      this.stuckCounter++;
    } else {
      this.stuckCounter = 0;
      this.lastTileX = myTx;
      this.lastTileY = myTy;
    }

    // Force re-evaluate if stuck
    if (this.stuckCounter > 45) {
      this.reevaluateTimer = 0;
      this.stuckCounter = 0;
    }

    const dangerMap = AIController.calculateDangerMap(map, bombManager);
    const isCurrentTileDangerous = dangerMap[myTy][myTx] > 0;

    // 1. EMERGENCY EVACUATION (Highest Priority)
    if (isCurrentTileDangerous) {
      const escapePath = this.findPathToSafety(myTx, myTy, map, bombManager, dangerMap);
      if (escapePath.length > 1) {
        this.stepAlongPath(escapePath[1], map, bombManager);
        return;
      } else {
        // Fallback: Try any adjacent walkable tile with a lower danger
        const bestAdjacent = this.findLeastDangerousAdjacent(myTx, myTy, map, bombManager, dangerMap);
        if (bestAdjacent) {
          this.stepAlongPath(bestAdjacent, map, bombManager);
          return;
        }
      }
    }

    // 2. REGULAR STRATEGIC EVALUATION
    if (this.reevaluateTimer <= 0) {
      this.reevaluateTimer = 12 + Math.floor(Math.random() * 8); // Re-evaluate every ~15 frames

      // Check for nearby collectibles if healthy
      let targetGoal: TileCoord | null = null;

      // Strategy A: Collector personality or nearby powerup
      if (this.player.config.personality === 'collector' || Math.random() < 0.6) {
        targetGoal = this.findNearestItem(myTx, myTy, map, bombManager, dangerMap);
      }

      // Strategy B: Attack / Bomb nearby soft block or enemy
      if (!targetGoal) {
        // Check if we are adjacent to a soft block or enemy to place a bomb
        const canSafelyBomb = this.canPlaceBombSafely(myTx, myTy, map, bombManager);

        if (canSafelyBomb && this.player.activeBombs < this.player.maxBombs) {
          const adjacentSoftBlock = this.hasAdjacentSoftBlock(myTx, myTy, map);
          const adjacentEnemy = this.hasNearbyEnemy(myTx, myTy, allPlayers);

          if (adjacentSoftBlock || adjacentEnemy) {
            // Drop bomb!
            requestPlaceBomb(this.player);
            // Immediately path to safety
            const newDanger = AIController.calculateDangerMap(map, bombManager);
            const immediateEscape = this.findPathToSafety(myTx, myTy, map, bombManager, newDanger);
            if (immediateEscape.length > 1) {
              this.stepAlongPath(immediateEscape[1], map, bombManager);
            }
            return;
          }
        }

        // Seek nearest soft block or enemy
        targetGoal = this.findNearestSoftBlockTarget(myTx, myTy, map, bombManager, dangerMap);
      }

      if (targetGoal) {
        this.currentPath = this.findPathBFS(myTx, myTy, targetGoal.x, targetGoal.y, map, bombManager, dangerMap);
      } else {
        this.currentPath = [];
      }
    }

    // 3. EXECUTE MOVEMENT TOWARDS TARGET
    if (this.currentPath.length > 1) {
      const nextTile = this.currentPath[1];
      // If next step became dangerous, stop and re-evaluate next frame
      if (dangerMap[nextTile.y][nextTile.x] > 0) {
        this.reevaluateTimer = 0;
        return;
      }

      this.stepAlongPath(nextTile, map, bombManager);

      // If reached tile center, advance path
      const targetPx = nextTile.x * TILE_SIZE + TILE_SIZE / 2;
      const targetPy = nextTile.y * TILE_SIZE + TILE_SIZE / 2;
      if (Math.hypot(this.player.x - targetPx, this.player.y - targetPy) < 8) {
        this.currentPath.shift();
      }
    } else {
      // Idle / slight wander to align to tile center
      const centerX = myTx * TILE_SIZE + TILE_SIZE / 2;
      const centerY = myTy * TILE_SIZE + TILE_SIZE / 2;
      const dx = Math.abs(this.player.x - centerX) > 3 ? Math.sign(centerX - this.player.x) : 0;
      const dy = Math.abs(this.player.y - centerY) > 3 ? Math.sign(centerY - this.player.y) : 0;
      this.player.move(dx, dy, map, bombManager);
    }
  }

  /**
   * Moves player towards target tile center
   */
  private stepAlongPath(targetTile: TileCoord, map: GameMap, bombManager: BombManager) {
    const targetPx = targetTile.x * TILE_SIZE + TILE_SIZE / 2;
    const targetPy = targetTile.y * TILE_SIZE + TILE_SIZE / 2;

    const diffX = targetPx - this.player.x;
    const diffY = targetPy - this.player.y;

    let moveX = 0;
    let moveY = 0;

    if (Math.abs(diffX) > 2) moveX = Math.sign(diffX);
    if (Math.abs(diffY) > 2) moveY = Math.sign(diffY);

    this.player.move(moveX, moveY, map, bombManager);
  }

  /**
   * Suicide Prevention: Simulates placing a bomb at (bx, by) and verifies
   * whether the AI can reach at least one 100% safe tile before fuse runs out.
   */
  private canPlaceBombSafely(bx: number, by: number, map: GameMap, bombManager: BombManager): boolean {
    // Virtual danger simulation
    const simulatedDanger: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));

    // Copy existing danger
    const currentDanger = AIController.calculateDangerMap(map, bombManager);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        simulatedDanger[y][x] = currentDanger[y][x];
      }
    }

    // Add candidate bomb's blast
    const power = this.player.power;
    simulatedDanger[by][bx] = 150;
    const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
    for (const { dx, dy } of dirs) {
      for (let dist = 1; dist <= power; dist++) {
        const tx = bx + dx * dist;
        const ty = by + dy * dist;
        if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) break;
        if (map.getTile(tx, ty) === TILE.WALL) break;
        simulatedDanger[ty][tx] = 150;
        if (map.getTile(tx, ty) === TILE.SOFT_BLOCK) break;
      }
    }

    // Check if an escape path exists to a 0-danger tile
    const escapePath = this.findPathToSafety(bx, by, map, bombManager, simulatedDanger);
    return escapePath.length > 0;
  }

  /**
   * BFS to find shortest path to any tile with danger === 0
   */
  private findPathToSafety(
    startX: number,
    startY: number,
    map: GameMap,
    bombManager: BombManager,
    dangerMap: number[][]
  ): TileCoord[] {
    const queue: TileCoord[] = [{ x: startX, y: startY }];
    const visited = new Set<string>();
    const parent = new Map<string, TileCoord | null>();

    const startKey = `${startX},${startY}`;
    visited.add(startKey);
    parent.set(startKey, null);

    let foundSafe: TileCoord | null = null;

    const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];

    while (queue.length > 0) {
      const cur = queue.shift()!;

      // Found safe spot!
      if (dangerMap[cur.y][cur.x] === 0) {
        foundSafe = cur;
        break;
      }

      for (const { dx, dy } of dirs) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const key = `${nx},${ny}`;

        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        if (visited.has(key)) continue;

        // Must be walkable floor
        if (!map.isWalkable(nx, ny)) continue;

        // Cannot walk onto other bombs
        if (bombManager.getBombAt(nx, ny) && (nx !== startX || ny !== startY)) continue;

        visited.add(key);
        parent.set(key, cur);
        queue.push({ x: nx, y: ny });
      }
    }

    if (!foundSafe) return [];

    // Reconstruct path
    const path: TileCoord[] = [];
    let curr: TileCoord | null = foundSafe;
    while (curr !== null) {
      path.unshift(curr);
      curr = parent.get(`${curr.x},${curr.y}`) || null;
    }
    return path;
  }

  /**
   * Standard BFS pathfinding from (sx, sy) to (gx, gy) avoiding dangerous tiles
   */
  private findPathBFS(
    sx: number,
    sy: number,
    gx: number,
    gy: number,
    map: GameMap,
    bombManager: BombManager,
    dangerMap: number[][]
  ): TileCoord[] {
    if (sx === gx && sy === gy) return [{ x: sx, y: sy }];

    const queue: TileCoord[] = [{ x: sx, y: sy }];
    const visited = new Set<string>();
    const parent = new Map<string, TileCoord | null>();

    const startKey = `${sx},${sy}`;
    visited.add(startKey);
    parent.set(startKey, null);

    let reached = false;
    const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];

    while (queue.length > 0) {
      const cur = queue.shift()!;

      if (cur.x === gx && cur.y === gy) {
        reached = true;
        break;
      }

      for (const { dx, dy } of dirs) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const key = `${nx},${ny}`;

        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        if (visited.has(key)) continue;

        // Skip dangerous tiles in general pathfinding
        if (dangerMap[ny][nx] > 0) continue;

        // Walkable check (destination might be item tile which is walkable)
        if (!map.isWalkable(nx, ny)) continue;
        if (bombManager.getBombAt(nx, ny)) continue;

        visited.add(key);
        parent.set(key, cur);
        queue.push({ x: nx, y: ny });
      }
    }

    if (!reached) return [];

    const path: TileCoord[] = [];
    let curr: TileCoord | null = { x: gx, y: gy };
    while (curr !== null) {
      path.unshift(curr);
      curr = parent.get(`${curr.x},${curr.y}`) || null;
    }
    return path;
  }

  private findNearestItem(
    myTx: number,
    myTy: number,
    map: GameMap,
    bombManager: BombManager,
    dangerMap: number[][]
  ): TileCoord | null {
    let nearest: TileCoord | null = null;
    let minD = Infinity;

    for (const item of map.activeItems) {
      if (dangerMap[item.tileY][item.tileX] > 0) continue;
      const d = Math.abs(item.tileX - myTx) + Math.abs(item.tileY - myTy);
      if (d < minD) {
        minD = d;
        nearest = { x: item.tileX, y: item.tileY };
      }
    }
    return nearest;
  }

  private findNearestSoftBlockTarget(
    myTx: number,
    myTy: number,
    map: GameMap,
    bombManager: BombManager,
    dangerMap: number[][]
  ): TileCoord | null {
    let bestSpot: TileCoord | null = null;
    let minD = Infinity;

    const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];

    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (map.getTile(x, y) === TILE.SOFT_BLOCK) {
          // Check adjacent walkable tiles
          for (const { dx, dy } of dirs) {
            const adjX = x + dx;
            const adjY = y + dy;
            if (map.isWalkable(adjX, adjY) && dangerMap[adjY][adjX] === 0) {
              const dist = Math.abs(adjX - myTx) + Math.abs(adjY - myTy);
              if (dist < minD) {
                minD = dist;
                bestSpot = { x: adjX, y: adjY };
              }
            }
          }
        }
      }
    }
    return bestSpot;
  }

  private hasAdjacentSoftBlock(tx: number, ty: number, map: GameMap): boolean {
    const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
    return dirs.some(({ dx, dy }) => map.getTile(tx + dx, ty + dy) === TILE.SOFT_BLOCK);
  }

  private hasNearbyEnemy(myTx: number, myTy: number, allPlayers: Player[]): boolean {
    return allPlayers.some(
      (p) => p.isAlive && p.config.id !== this.player.config.id && Math.hypot(p.tileX - myTx, p.tileY - myTy) <= 2.5
    );
  }

  private findLeastDangerousAdjacent(
    myTx: number,
    myTy: number,
    map: GameMap,
    bombManager: BombManager,
    dangerMap: number[][]
  ): TileCoord | null {
    const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
    let best: TileCoord | null = null;
    let maxTimeLeft = -1;

    for (const { dx, dy } of dirs) {
      const nx = myTx + dx;
      const ny = myTy + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      if (!map.isWalkable(nx, ny) || bombManager.getBombAt(nx, ny)) continue;

      const danger = dangerMap[ny][nx];
      // Greater fuse time remaining is safer
      if (danger > maxTimeLeft) {
        maxTimeLeft = danger;
        best = { x: nx, y: ny };
      }
    }
    return best;
  }
}
