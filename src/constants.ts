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
export const PLAYER_HITBOX_RADIUS = 13.5; // Collision radius (lenient for smooth turns and corridor clearance)
export const CORNERING_ASSIST_THRESHOLD = 24; // Half-tile distance to snap/slide around corners and crossroads

// Character Skills
export type SkillType = 'DASH' | 'REMOTE_DETONATE' | 'MEGA_BOMB' | 'SHIELD_DEPLOY' | 'TACKLE';

export interface CharacterInfo {
  charId: string;
  name: string;
  jpName: string;
  role: string;
  folder: string;
  color: string;
  subColor: string;
  accentColor: string;
  skillType: SkillType;
  skillName: string;
  skillDesc: string;
  skillCooldown: number; // in frames (60fps)
}

export const CHARACTERS: Record<string, CharacterInfo> = {
  bomber_blue: {
    charId: 'bomber_blue',
    name: 'Bomber Blue',
    jpName: 'ボンバーブルー',
    role: 'オールラウンダー',
    folder: 'characters/bomber_blue',
    color: '#3b82f6',
    subColor: '#ffffff',
    accentColor: '#f43f5e',
    skillType: 'DASH',
    skillName: 'ダッシュ (Dash)',
    skillDesc: '向いている方向へ素早く2マス突進！爆風回避に',
    skillCooldown: 480, // 8 seconds
  },
  bomber_black: {
    charId: 'bomber_black',
    name: 'Bomber Black',
    jpName: 'ボンバーブラック',
    role: 'スピードスター',
    folder: 'characters/bomber_black',
    color: '#1e293b',
    subColor: '#ef4444',
    accentColor: '#fbbf24',
    skillType: 'REMOTE_DETONATE',
    skillName: 'リモコン起爆 (Remote)',
    skillDesc: '直前に置いた自分のボムを好きなタイミングで遠隔爆破！',
    skillCooldown: 600, // 10 seconds
  },
  bomber_red: {
    charId: 'bomber_red',
    name: 'Bomber Red',
    jpName: 'ボンバーレッド',
    role: 'パワーファイター',
    folder: 'characters/bomber_red',
    color: '#dc2626',
    subColor: '#ffffff',
    accentColor: '#f59e0b',
    skillType: 'MEGA_BOMB',
    skillName: 'メガボム (Mega Bomb)',
    skillDesc: '次回置くボムがブロック貫通の超特大メガボムになる！',
    skillCooldown: 720, // 12 seconds
  },
  bomber_green: {
    charId: 'bomber_green',
    name: 'Bomber Green',
    jpName: 'ボンバーグリーン',
    role: 'ディフェンダー',
    folder: 'characters/bomber_green',
    color: '#059669',
    subColor: '#facc15',
    accentColor: '#f97316',
    skillType: 'SHIELD_DEPLOY',
    skillName: '緊急シールド (Shield)',
    skillDesc: '3秒間、爆風を防ぐエネルギーシールドを1枚展開！',
    skillCooldown: 900, // 15 seconds
  },
  bomber_purple: {
    charId: 'bomber_purple',
    name: 'Bomber Purple',
    jpName: 'ボンバーパープル',
    role: 'ストライカー',
    folder: 'characters/bomber_purple',
    color: '#8b5cf6',
    subColor: '#ede9fe',
    accentColor: '#fbbf24',
    skillType: 'TACKLE',
    skillName: 'スタンタックル (Tackle)',
    skillDesc: '向いている方向へ2マス突進！当たった敵を3秒間スタンさせる',
    skillCooldown: 600, // 10 seconds
  },
};

// Player appearance & config
export interface PlayerConfig {
  id: number;
  charId: string;
  name: string;
  isHuman: boolean;
  color: string;       // Primary suit color
  subColor: string;    // Secondary/trim color
  accentColor: string; // Highlights/shoes
  nameTag: string;
  spawnTileX: number;
  spawnTileY: number;
  personality: 'balanced' | 'aggressive' | 'collector' | 'cautious';
  skillType: SkillType;
  skillCooldown: number;
}

export const PLAYER_CONFIGS: PlayerConfig[] = [
  {
    id: 0,
    charId: 'bomber_blue',
    name: 'Player 1',
    isHuman: true,
    color: '#3b82f6',
    subColor: '#ffffff',
    accentColor: '#f43f5e',
    nameTag: 'P1 (You)',
    spawnTileX: 1,
    spawnTileY: 1,
    personality: 'balanced',
    skillType: 'DASH',
    skillCooldown: 480,
  },
  {
    id: 1,
    charId: 'bomber_black',
    name: 'COM 1',
    isHuman: false,
    color: '#1e293b',
    subColor: '#ef4444',
    accentColor: '#fbbf24',
    nameTag: 'COM 1 (Black)',
    spawnTileX: 13,
    spawnTileY: 1,
    personality: 'aggressive',
    skillType: 'REMOTE_DETONATE',
    skillCooldown: 600,
  },
  {
    id: 2,
    charId: 'bomber_red',
    name: 'COM 2',
    isHuman: false,
    color: '#dc2626',
    subColor: '#ffffff',
    accentColor: '#f59e0b',
    nameTag: 'COM 2 (Red)',
    spawnTileX: 1,
    spawnTileY: 11,
    personality: 'collector',
    skillType: 'MEGA_BOMB',
    skillCooldown: 720,
  },
  {
    id: 3,
    charId: 'bomber_green',
    name: 'COM 3',
    isHuman: false,
    color: '#059669',
    subColor: '#facc15',
    accentColor: '#f97316',
    nameTag: 'COM 3 (Green)',
    spawnTileX: 13,
    spawnTileY: 11,
    personality: 'cautious',
    skillType: 'SHIELD_DEPLOY',
    skillCooldown: 900,
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
