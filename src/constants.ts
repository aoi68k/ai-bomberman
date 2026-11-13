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
export type SkillType = 'DASH' | 'REMOTE_DETONATE' | 'MEGA_BOMB' | 'SHIELD_DEPLOY' | 'TACKLE' | 'CHEN_SLASH_RUSH' | 'YANGYANG_WIND_SLASH';
export type UltraType = 'ULTRA_BLITZ_DASH' | 'ULTRA_ALL_DETONATE' | 'ULTRA_NOVA_BOMB' | 'ULTRA_FORTRESS' | 'ULTRA_METEOR_TACKLE' | 'CHEN_TEMPEST_RUSH' | 'YANGYANG_TEMPEST_ZONE';

export interface CharacterStats {
  initialBombs?: number;
  initialPower?: number;
  initialSpeed?: number;
}

export interface CharacterInfo {
  charId: string;
  name: string;
  jpName: string;
  role: string;
  folder?: string; // Populated automatically from directory scan
  color: string;
  subColor: string;
  accentColor: string;
  stats?: CharacterStats;
  skillType: SkillType;
  skillName: string;
  skillDesc: string;
  skillCooldown: number; // in frames (60fps)
  ultraType: UltraType;
  ultraName: string;
  ultraDesc: string;
  ultraCooldown: number; // in frames (60fps)
}

/**
 * Character catalog populated dynamically from public/assets/images/characters/<id>/character.json
 */
export const CHARACTERS: Record<string, CharacterInfo> = {};

// Discover all folders under public/assets/images/characters/ that contain character.json
const bundledCharacterModules = import.meta.glob<{ default: CharacterInfo }>(
  '../public/assets/images/characters/*/character.json',
  { eager: true }
);

/**
 * Loads all character definitions from folders under characters/ that contain character.json
 */
export async function loadCharacters(): Promise<void> {
  for (const key of Object.keys(CHARACTERS)) {
    delete CHARACTERS[key];
  }

  const preferredOrder = ['bomber_blue', 'bomber_black', 'bomber_red', 'bomber_green', 'bomber_purple', 'chen', 'yangyang'];
  const entries: CharacterInfo[] = [];

  await Promise.all(
    Object.entries(bundledCharacterModules).map(async ([modulePath, mod]) => {
      const match = modulePath.match(/characters\/([^/]+)\/character\.json$/);
      if (!match) return;
      const folderName = match[1];
      const bundledData = mod.default || (mod as unknown as CharacterInfo);

      let charData: CharacterInfo | null = null;
      // Try live fetch first (so runtime edits to character.json are reflected immediately on HTTP server)
      try {
        const res = await fetch(`assets/images/characters/${folderName}/character.json`, { cache: 'no-store' });
        if (res.ok) {
          charData = (await res.json()) as CharacterInfo;
        }
      } catch {
        // Ignore fetch errors in standalone/file:// mode
      }

      if (!charData && bundledData) {
        charData = { ...bundledData };
      }

      if (charData && charData.charId) {
        if (!charData.folder) {
          charData.folder = folderName;
        }
        entries.push(charData);
      }
    })
  );

  entries.sort((a, b) => {
    const ia = preferredOrder.indexOf(a.charId);
    const ib = preferredOrder.indexOf(b.charId);
    if (ia === -1 && ib === -1) return a.charId.localeCompare(b.charId);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  for (const char of entries) {
    CHARACTERS[char.charId] = char;
  }
}

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
  stats?: CharacterStats;
  skillType: SkillType;
  skillCooldown: number;
  ultraType: UltraType;
  ultraCooldown: number;
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
    ultraType: 'ULTRA_BLITZ_DASH',
    ultraCooldown: 1080,
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
    ultraType: 'ULTRA_ALL_DETONATE',
    ultraCooldown: 1200,
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
    ultraType: 'ULTRA_NOVA_BOMB',
    ultraCooldown: 1200,
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
    ultraType: 'ULTRA_FORTRESS',
    ultraCooldown: 1320,
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
