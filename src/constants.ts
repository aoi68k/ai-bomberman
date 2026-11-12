// Game configuration & constants

export const COLS = 15;
export const ROWS = 13;
export const TILE_SIZE = 48; // Canvas width = 15 * 48 = 720, height = 13 * 48 = 624

export const CANVAS_WIDTH = COLS * TILE_SIZE;
export const CANVAS_HEIGHT = ROWS * TILE_SIZE;

// Tile types
export const TILE = {
  EMPTY: 0,
  WALL: 1,       // Indestructible pillar/outer wall
  SOFT_BLOCK: 2, // Destructible block
} as const;

export type TileType = typeof TILE[keyof typeof TILE];

// Item types
export const ITEM = {
  BOMB_UP: 'bomb_up',
  FIRE_UP: 'fire_up',
  SPEED_UP: 'speed_up',
  KICK: 'kick',
  SHIELD: 'shield',
} as const;

export type ItemType = typeof ITEM[keyof typeof ITEM];

export interface ItemData {
  id: number;
  tileX: number;
  tileY: number;
  type: ItemType;
  spawnTime: number;
}

// Bomb settings
export const BOMB_FUSE_TIME = 150; // ~2.5 seconds at 60fps
export const EXPLOSION_DURATION = 32; // ~0.53 seconds at 60fps
export const BOMB_SLIDE_SPEED = 6.0;

// Player settings
export const INITIAL_PLAYER_SPEED = 2.6;
export const MAX_PLAYER_SPEED = 4.8;
export const SPEED_INCREMENT = 0.45;
export const INITIAL_BOMBS = 1;
export const MAX_BOMBS = 8;
export const INITIAL_POWER = 1;
export const MAX_POWER = 8;
export const PLAYER_HITBOX_RADIUS = 16; // Collision circle radius
export const CORNERING_ASSIST_THRESHOLD = 18; // Max distance to snap/slide around corners

// Player appearance & config
export interface PlayerConfig {
  id: number;
  name: string;
  isHuman: boolean;
  color: string;       // Primary suit color
  subColor: string;    // Secondary/trim color
  accentColor: string; // Highlights/shoes
  nameTag: string;
  spawnTileX: number;
  spawnTileY: number;
  personality: 'balanced' | 'aggressive' | 'collector' | 'cautious';
}

export const PLAYER_CONFIGS: PlayerConfig[] = [
  {
    id: 0,
    name: 'Player 1',
    isHuman: true,
    color: '#3b82f6',       // Blue suit
    subColor: '#ffffff',    // White helmet
    accentColor: '#f43f5e', // Pink/Red trim
    nameTag: 'P1 (You)',
    spawnTileX: 1,
    spawnTileY: 1,
    personality: 'balanced',
  },
  {
    id: 1,
    name: 'COM 1',
    isHuman: false,
    color: '#1e293b',       // Black suit
    subColor: '#ef4444',    // Red visor/trim
    accentColor: '#fbbf24', // Yellow trim
    nameTag: 'COM 1 (Black)',
    spawnTileX: 13,
    spawnTileY: 1,
    personality: 'aggressive',
  },
  {
    id: 2,
    name: 'COM 2',
    isHuman: false,
    color: '#dc2626',       // Red suit
    subColor: '#ffffff',    // White helmet
    accentColor: '#f59e0b', // Amber trim
    nameTag: 'COM 2 (Red)',
    spawnTileX: 1,
    spawnTileY: 11,
    personality: 'collector',
  },
  {
    id: 3,
    name: 'COM 3',
    isHuman: false,
    color: '#059669',       // Green suit
    subColor: '#facc15',    // Yellow helmet
    accentColor: '#f97316', // Orange trim
    nameTag: 'COM 3 (Green)',
    spawnTileX: 13,
    spawnTileY: 11,
    personality: 'cautious',
  },
];

// Spawning safe zones (tiles where soft blocks must not spawn)
export const SPAWN_SAFE_ZONES = [
  // Top-left (P1)
  { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 },
  // Top-right (P2)
  { x: 13, y: 1 }, { x: 12, y: 1 }, { x: 13, y: 2 },
  // Bottom-left (P3)
  { x: 1, y: 11 }, { x: 2, y: 11 }, { x: 1, y: 10 },
  // Bottom-right (P4)
  { x: 13, y: 11 }, { x: 12, y: 11 }, { x: 13, y: 10 },
];
