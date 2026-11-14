// Advanced AI Brain for COM Opponents in AI-Bomberman

import { COLS, ROWS, TILE, TILE_SIZE } from './constants';
import { GameMap } from './map';
import { BombManager, Bomb } from './bomb';
import { Player } from './player';

interface TileCoord {
  x: number;
  y: number;
}

const GRID_CELLS = ROWS * COLS;
const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

export class AIController {
  private player: Player;
  private currentPath: TileCoord[] = [];
  private reevaluateTimer: number = 0;
  private lastTileX: number = -1;
  private lastTileY: number = -1;
  private stuckCounter: number = 0;
  private skillDecisionTimer: number = 30;

  // Reusable typed buffers for zero-allocation BFS
  private bfsVisited = new Uint8Array(GRID_CELLS);
  private bfsParent = new Int16Array(GRID_CELLS);
  private bfsQueue = new Int16Array(GRID_CELLS);

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

      for (const { dx, dy } of DIRS) {
        for (let dist = 1; dist <= bomb.power; dist++) {
          const tx = bx + dx * dist;
          const ty = by + dy * dist;

          if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) break;

          const tile = map.getTile(tx, ty);
          if (tile === TILE.WALL || tile === TILE.SOFT_BLOCK) break; // Wall & soft block stop blast ray

          danger[ty][tx] = danger[ty][tx] === 0 ? timeLeft : Math.min(danger[ty][tx], timeLeft);
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
    requestPlaceBomb: (player: Player) => boolean,
    sharedDangerMap?: number[][],
    requestUseSkill?: (player: Player) => boolean,
    requestUseUltra?: (player: Player) => boolean,
    requestUseChainBomb?: (player: Player) => boolean
  ) {
    if (!this.player.isAlive || this.player.stunTimer > 0 || this.player.isTackling || this.player.slashSequenceTimer > 0) {
      return;
    }

    this.reevaluateTimer--;
    this.skillDecisionTimer--;

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

    const dangerMap = sharedDangerMap ?? AIController.calculateDangerMap(map, bombManager);
    const isCurrentTileDangerous = dangerMap[myTy][myTx] > 0;

    // 0. TACTICAL SKILL / ULTRA USAGE (Evaluated periodically so COM uses them naturally)
    if (this.skillDecisionTimer <= 0) {
      this.skillDecisionTimer = 24 + Math.floor(Math.random() * 22);
      if (
        requestUseUltra &&
        this.player.ultraGauge >= 10 &&
        this.tryTacticalUltra(myTx, myTy, map, bombManager, allPlayers, dangerMap, isCurrentTileDangerous, requestUseUltra)
      ) {
        this.reevaluateTimer = 0;
        return;
      }
      if (
        (requestUseSkill || requestUseChainBomb) &&
        this.tryTacticalSkill(
          myTx,
          myTy,
          map,
          bombManager,
          allPlayers,
          dangerMap,
          isCurrentTileDangerous,
          requestUseSkill,
          requestUseChainBomb
        )
      ) {
        this.reevaluateTimer = 0;
        return;
      }
    }

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
        const canSafelyBomb = this.canPlaceBombSafely(myTx, myTy, map, bombManager, dangerMap);

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
  private canPlaceBombSafely(
    bx: number,
    by: number,
    map: GameMap,
    bombManager: BombManager,
    currentDanger: number[][],
    powerOverride?: number
  ): boolean {
    const simulatedDanger: number[][] = Array.from({ length: ROWS }, (_, y) => [...currentDanger[y]]);

    // Add candidate bomb's blast
    const power = powerOverride ?? this.player.power;
    simulatedDanger[by][bx] = 150;
    for (const { dx, dy } of DIRS) {
      for (let dist = 1; dist <= power; dist++) {
        const tx = bx + dx * dist;
        const ty = by + dy * dist;
        if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) break;
        const tile = map.getTile(tx, ty);
        if (tile === TILE.WALL || tile === TILE.SOFT_BLOCK) break;
        simulatedDanger[ty][tx] = 150;
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
    this.bfsVisited.fill(0);
    this.bfsParent.fill(-1);

    const startIdx = startY * COLS + startX;
    this.bfsVisited[startIdx] = 1;
    let head = 0;
    let tail = 0;
    this.bfsQueue[tail++] = startIdx;

    let foundIdx = -1;

    while (head < tail) {
      const curIdx = this.bfsQueue[head++];
      const curX = curIdx % COLS;
      const curY = (curIdx - curX) / COLS;

      if (dangerMap[curY][curX] === 0) {
        foundIdx = curIdx;
        break;
      }

      for (const { dx, dy } of DIRS) {
        const nx = curX + dx;
        const ny = curY + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;

        const nIdx = ny * COLS + nx;
        if (this.bfsVisited[nIdx]) continue;
        if (!map.isWalkable(nx, ny)) continue;
        if (bombManager.getBombAt(nx, ny) && (nx !== startX || ny !== startY)) continue;

        this.bfsVisited[nIdx] = 1;
        this.bfsParent[nIdx] = curIdx;
        this.bfsQueue[tail++] = nIdx;
      }
    }

    if (foundIdx === -1) return [];

    const path: TileCoord[] = [];
    let curr = foundIdx;
    while (curr !== -1) {
      const cx = curr % COLS;
      const cy = (curr - cx) / COLS;
      path.push({ x: cx, y: cy });
      curr = this.bfsParent[curr];
    }
    path.reverse();
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

    this.bfsVisited.fill(0);
    this.bfsParent.fill(-1);

    const startIdx = sy * COLS + sx;
    const goalIdx = gy * COLS + gx;
    this.bfsVisited[startIdx] = 1;
    let head = 0;
    let tail = 0;
    this.bfsQueue[tail++] = startIdx;

    let reached = false;

    while (head < tail) {
      const curIdx = this.bfsQueue[head++];
      if (curIdx === goalIdx) {
        reached = true;
        break;
      }

      const curX = curIdx % COLS;
      const curY = (curIdx - curX) / COLS;

      for (const { dx, dy } of DIRS) {
        const nx = curX + dx;
        const ny = curY + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;

        const nIdx = ny * COLS + nx;
        if (this.bfsVisited[nIdx]) continue;
        if (dangerMap[ny][nx] > 0) continue;
        if (!map.isWalkable(nx, ny)) continue;
        if (bombManager.getBombAt(nx, ny)) continue;

        this.bfsVisited[nIdx] = 1;
        this.bfsParent[nIdx] = curIdx;
        this.bfsQueue[tail++] = nIdx;
      }
    }

    if (!reached) return [];

    const path: TileCoord[] = [];
    let curr = goalIdx;
    while (curr !== -1) {
      const cx = curr % COLS;
      const cy = (curr - cx) / COLS;
      path.push({ x: cx, y: cy });
      curr = this.bfsParent[curr];
    }
    path.reverse();
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

  private getFacingVector(): { dx: number; dy: number } {
    switch (this.player.facing) {
      case 'up':
        return { dx: 0, dy: -1 };
      case 'down':
        return { dx: 0, dy: 1 };
      case 'left':
        return { dx: -1, dy: 0 };
      case 'right':
      default:
        return { dx: 1, dy: 0 };
    }
  }

  private hasEnemyInFront(myTx: number, myTy: number, maxRange: number, allPlayers: Player[], map: GameMap): boolean {
    const { dx, dy } = this.getFacingVector();
    for (let step = 1; step <= maxRange; step++) {
      const tx = myTx + dx * step;
      const ty = myTy + dy * step;
      if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) break;
      if (map.getTile(tx, ty) === TILE.WALL) break;
      for (const p of allPlayers) {
        if (!p.isAlive || p.config.id === this.player.config.id) continue;
        if (Math.abs(p.tileX - tx) + Math.abs(p.tileY - ty) <= 1) {
          return true;
        }
      }
    }
    return false;
  }

  private isEnemyInOwnBombBlast(map: GameMap, bombManager: BombManager, allPlayers: Player[]): boolean {
    for (const bomb of bombManager.bombs) {
      if (bomb.ownerId !== this.player.config.id) continue;
      for (const p of allPlayers) {
        if (!p.isAlive || p.config.id === this.player.config.id) continue;
        if (p.tileX === bomb.tileX && Math.abs(p.tileY - bomb.tileY) <= bomb.power) {
          let blocked = false;
          const step = Math.sign(p.tileY - bomb.tileY);
          for (let y = bomb.tileY + step; y !== p.tileY; y += step) {
            const tile = map.getTile(bomb.tileX, y);
            if (tile === TILE.WALL || tile === TILE.SOFT_BLOCK) {
              blocked = true;
              break;
            }
          }
          if (!blocked) return true;
        }
        if (p.tileY === bomb.tileY && Math.abs(p.tileX - bomb.tileX) <= bomb.power) {
          let blocked = false;
          const step = Math.sign(p.tileX - bomb.tileX);
          for (let x = bomb.tileX + step; x !== p.tileX; x += step) {
            const tile = map.getTile(x, bomb.tileY);
            if (tile === TILE.WALL || tile === TILE.SOFT_BLOCK) {
              blocked = true;
              break;
            }
          }
          if (!blocked) return true;
        }
      }
    }
    return false;
  }

  private isLineSafe(
    myTx: number,
    myTy: number,
    dx: number,
    dy: number,
    steps: number,
    map: GameMap,
    dangerMap: number[][]
  ): boolean {
    let lastTx = myTx;
    let lastTy = myTy;
    for (let s = 1; s <= steps; s++) {
      const tx = Math.max(1, Math.min(COLS - 2, myTx + dx * s));
      const ty = Math.max(1, Math.min(ROWS - 2, myTy + dy * s));
      if (!map.isWalkable(tx, ty)) break;
      lastTx = tx;
      lastTy = ty;
    }
    return dangerMap[lastTy][lastTx] === 0;
  }

  private tryTacticalUltra(
    myTx: number,
    myTy: number,
    map: GameMap,
    bombManager: BombManager,
    allPlayers: Player[],
    dangerMap: number[][],
    isCurrentTileDangerous: boolean,
    requestUseUltra: (player: Player) => boolean
  ): boolean {
    const ultraType = this.player.config.ultraType;
    const { dx, dy } = this.getFacingVector();
    const enemyNear = allPlayers.some(
      (p) => p.isAlive && p.config.id !== this.player.config.id && Math.hypot(p.tileX - myTx, p.tileY - myTy) <= 4.5
    );

    switch (ultraType) {
      case 'ULTRA_FORTRESS': {
        if ((isCurrentTileDangerous && this.player.shield < 2) || (enemyNear && Math.random() < 0.35)) {
          return requestUseUltra(this.player);
        }
        return false;
      }

      case 'ULTRA_BLITZ_DASH': {
        const targetTx = Math.max(1, Math.min(13, myTx + dx * 3));
        const targetTy = Math.max(1, Math.min(11, myTy + dy * 3));
        const landingSafe =
          map.isWalkable(targetTx, targetTy) && !bombManager.getBombAt(targetTx, targetTy) && dangerMap[targetTy][targetTx] === 0;
        if (landingSafe && (isCurrentTileDangerous || (this.hasEnemyInFront(myTx, myTy, 5, allPlayers, map) && Math.random() < 0.4))) {
          return requestUseUltra(this.player);
        }
        return false;
      }

      case 'ULTRA_ALL_DETONATE': {
        if (isCurrentTileDangerous) return false;
        const ownBombs = bombManager.bombs.filter((b) => b.ownerId === this.player.config.id);
        if (ownBombs.length === 0) return false;
        if (this.isEnemyInOwnBombBlast(map, bombManager, allPlayers) || (ownBombs.length >= 2 && Math.random() < 0.35)) {
          return requestUseUltra(this.player);
        }
        return false;
      }

      case 'ULTRA_NOVA_BOMB': {
        if (isCurrentTileDangerous || this.player.activeBombs >= this.player.maxBombs) return false;
        if ((enemyNear || this.hasAdjacentSoftBlock(myTx, myTy, map)) && Math.random() < 0.45) {
          if (this.canPlaceBombSafely(myTx, myTy, map, bombManager, dangerMap, 8)) {
            return requestUseUltra(this.player);
          }
        }
        return false;
      }

      case 'CHEN_TEMPEST_RUSH': {
        if (this.hasEnemyInFront(myTx, myTy, 4, allPlayers, map) && this.isLineSafe(myTx, myTy, dx, dy, 4, map, dangerMap)) {
          if (Math.random() < 0.55) {
            return requestUseUltra(this.player);
          }
        }
        return false;
      }

      case 'ULTRA_METEOR_TACKLE': {
        if (this.hasEnemyInFront(myTx, myTy, 3, allPlayers, map) && this.isLineSafe(myTx, myTy, dx, dy, 3, map, dangerMap)) {
          if (Math.random() < 0.5) {
            return requestUseUltra(this.player);
          }
        }
        return false;
      }

      case 'YANGYANG_TEMPEST_ZONE': {
        const cx = Math.max(1, Math.min(13, myTx + dx));
        const cy = Math.max(1, Math.min(11, myTy + dy));
        const enemyInZoneRange = allPlayers.some(
          (p) => p.isAlive && p.config.id !== this.player.config.id && Math.abs(p.tileX - cx) <= 2 && Math.abs(p.tileY - cy) <= 2
        );
        if (enemyInZoneRange && Math.random() < 0.55) {
          return requestUseUltra(this.player);
        }
        return false;
      }
    }

    return false;
  }

  private tryTacticalSkill(
    myTx: number,
    myTy: number,
    map: GameMap,
    bombManager: BombManager,
    allPlayers: Player[],
    dangerMap: number[][],
    isCurrentTileDangerous: boolean,
    requestUseSkill?: (player: Player) => boolean,
    requestUseChainBomb?: (player: Player) => boolean
  ): boolean {
    const { dx, dy } = this.getFacingVector();

    // Chain Bomb item ammo or CHAIN_BOMB character skill
    if (this.player.chainBombAmmo > 0 || (this.player.config.skillType === 'CHAIN_BOMB' && this.player.skillCooldownTimer === 0)) {
      if (!isCurrentTileDangerous && (requestUseChainBomb || requestUseSkill)) {
        // Ensure a perpendicular escape tile exists so COM does not trap itself in a line of bombs
        const perp = dx !== 0 ? [{ px: 0, py: -1 }, { px: 0, py: 1 }] : [{ px: -1, py: 0 }, { px: 1, py: 0 }];
        const hasSideEscape = perp.some(
          ({ px, py }) =>
            map.isWalkable(myTx + px, myTy + py) &&
            !bombManager.getBombAt(myTx + px, myTy + py) &&
            dangerMap[myTy + py]?.[myTx + px] === 0
        );
        if (
          hasSideEscape &&
          (this.hasEnemyInFront(myTx, myTy, 5, allPlayers, map) || this.hasAdjacentSoftBlock(myTx, myTy, map)) &&
          Math.random() < 0.35
        ) {
          return (requestUseChainBomb ?? requestUseSkill)!(this.player);
        }
      }
      if (this.player.chainBombAmmo > 0) return false;
    }

    if (!requestUseSkill || this.player.skillCooldownTimer > 0) return false;

    const skillType = this.player.config.skillType;
    const enemyNear = allPlayers.some(
      (p) => p.isAlive && p.config.id !== this.player.config.id && Math.hypot(p.tileX - myTx, p.tileY - myTy) <= 4
    );

    switch (skillType) {
      case 'DASH': {
        const targetTx = Math.max(1, Math.min(13, myTx + dx * 2));
        const targetTy = Math.max(1, Math.min(11, myTy + dy * 2));
        const landingSafe =
          map.isWalkable(targetTx, targetTy) && !bombManager.getBombAt(targetTx, targetTy) && dangerMap[targetTy][targetTx] === 0;
        if (landingSafe && (isCurrentTileDangerous || (this.currentPath.length > 3 && Math.random() < 0.25))) {
          return requestUseSkill(this.player);
        }
        return false;
      }

      case 'TACKLE': {
        if (this.hasEnemyInFront(myTx, myTy, 2, allPlayers, map) && this.isLineSafe(myTx, myTy, dx, dy, 2, map, dangerMap)) {
          if (Math.random() < 0.45) {
            return requestUseSkill(this.player);
          }
        }
        return false;
      }

      case 'REMOTE_DETONATE': {
        if (!isCurrentTileDangerous && this.isEnemyInOwnBombBlast(map, bombManager, allPlayers) && Math.random() < 0.65) {
          return requestUseSkill(this.player);
        }
        return false;
      }

      case 'MEGA_BOMB': {
        if (!this.player.hasMegaBomb && !isCurrentTileDangerous && (enemyNear || this.hasAdjacentSoftBlock(myTx, myTy, map))) {
          if (Math.random() < 0.35) {
            return requestUseSkill(this.player);
          }
        }
        return false;
      }

      case 'SHIELD_DEPLOY': {
        if (this.player.shield < 2 && ((isCurrentTileDangerous && Math.random() < 0.7) || (enemyNear && Math.random() < 0.3))) {
          return requestUseSkill(this.player);
        }
        return false;
      }

      case 'CHEN_SLASH_RUSH': {
        if (
          (this.hasEnemyInFront(myTx, myTy, 3, allPlayers, map) || this.hasNearbyEnemy(myTx, myTy, allPlayers)) &&
          this.isLineSafe(myTx, myTy, dx, dy, 2, map, dangerMap) &&
          Math.random() < 0.45
        ) {
          return requestUseSkill(this.player);
        }
        return false;
      }

      case 'YANGYANG_WIND_SLASH': {
        if (this.hasEnemyInFront(myTx, myTy, 3, allPlayers, map) && Math.random() < 0.5) {
          return requestUseSkill(this.player);
        }
        return false;
      }
    }

    return false;
  }
}
