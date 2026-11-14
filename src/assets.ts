// Asset Loader for custom PNG/SVG/WebP images
// If an image is not provided or fails to load, gracefully falls back to programmatic drawing.

export type ImageKey = string;

import { CharacterInfo } from './constants';

export class AssetManager {
  private images: Map<string, HTMLImageElement> = new Map();
  private loaded: Set<string> = new Set();

  /**
   * Defines candidate file paths for each image resource
   */
  private assetManifest: Record<string, string[]> = {
    wall: ['assets/images/environment/wall.png'],
    soft_block: ['assets/images/environment/soft_block.png'],
    floor: ['assets/images/environment/floor.png'],
    bomb: ['assets/images/items/bomb.png'],

    char_bomber_blue: ['assets/images/characters/bomber_blue/idle.png'],
    char_bomber_black: ['assets/images/characters/bomber_black/idle.png'],
    char_bomber_red: ['assets/images/characters/bomber_red/idle.png'],
    char_bomber_green: ['assets/images/characters/bomber_green/idle.png'],
    char_bomber_purple: ['assets/images/characters/bomber_purple/idle.png'],
    char_chen: ['assets/images/characters/chen/idle.png'],

    portrait_bomber_blue: ['assets/images/characters/bomber_blue/portrait.png', 'assets/images/characters/bomber_blue/idle.png'],
    portrait_bomber_black: ['assets/images/characters/bomber_black/portrait.png', 'assets/images/characters/bomber_black/idle.png'],
    portrait_bomber_red: ['assets/images/characters/bomber_red/portrait.png', 'assets/images/characters/bomber_red/idle.png'],
    portrait_bomber_green: ['assets/images/characters/bomber_green/portrait.png', 'assets/images/characters/bomber_green/idle.png'],
    portrait_bomber_purple: ['assets/images/characters/bomber_purple/portrait.png', 'assets/images/characters/bomber_purple/idle.png'],
    portrait_chen: ['assets/images/characters/chen/portrait.png', 'assets/images/characters/chen/idle.png'],

    // Directional Walk Motions (4-directions x 2-frames for characters)
    bomber_blue_down_0: ['assets/images/characters/bomber_blue/down_0.png'],
    bomber_blue_down_1: ['assets/images/characters/bomber_blue/down_1.png'],
    bomber_blue_up_0: ['assets/images/characters/bomber_blue/up_0.png'],
    bomber_blue_up_1: ['assets/images/characters/bomber_blue/up_1.png'],
    bomber_blue_left_0: ['assets/images/characters/bomber_blue/left_0.png'],
    bomber_blue_left_1: ['assets/images/characters/bomber_blue/left_1.png'],
    bomber_blue_right_0: ['assets/images/characters/bomber_blue/right_0.png'],
    bomber_blue_right_1: ['assets/images/characters/bomber_blue/right_1.png'],

    bomber_black_down_0: ['assets/images/characters/bomber_black/down_0.png'],
    bomber_black_down_1: ['assets/images/characters/bomber_black/down_1.png'],
    bomber_black_up_0: ['assets/images/characters/bomber_black/up_0.png'],
    bomber_black_up_1: ['assets/images/characters/bomber_black/up_1.png'],
    bomber_black_left_0: ['assets/images/characters/bomber_black/left_0.png'],
    bomber_black_left_1: ['assets/images/characters/bomber_black/left_1.png'],
    bomber_black_right_0: ['assets/images/characters/bomber_black/right_0.png'],
    bomber_black_right_1: ['assets/images/characters/bomber_black/right_1.png'],

    bomber_red_down_0: ['assets/images/characters/bomber_red/down_0.png'],
    bomber_red_down_1: ['assets/images/characters/bomber_red/down_1.png'],
    bomber_red_up_0: ['assets/images/characters/bomber_red/up_0.png'],
    bomber_red_up_1: ['assets/images/characters/bomber_red/up_1.png'],
    bomber_red_left_0: ['assets/images/characters/bomber_red/left_0.png'],
    bomber_red_left_1: ['assets/images/characters/bomber_red/left_1.png'],
    bomber_red_right_0: ['assets/images/characters/bomber_red/right_0.png'],
    bomber_red_right_1: ['assets/images/characters/bomber_red/right_1.png'],

    bomber_green_down_0: ['assets/images/characters/bomber_green/down_0.png'],
    bomber_green_down_1: ['assets/images/characters/bomber_green/down_1.png'],
    bomber_green_up_0: ['assets/images/characters/bomber_green/up_0.png'],
    bomber_green_up_1: ['assets/images/characters/bomber_green/up_1.png'],
    bomber_green_left_0: ['assets/images/characters/bomber_green/left_0.png'],
    bomber_green_left_1: ['assets/images/characters/bomber_green/left_1.png'],
    bomber_green_right_0: ['assets/images/characters/bomber_green/right_0.png'],
    bomber_green_right_1: ['assets/images/characters/bomber_green/right_1.png'],

    bomber_purple_down_0: ['assets/images/characters/bomber_purple/down_0.png'],
    bomber_purple_down_1: ['assets/images/characters/bomber_purple/down_1.png'],
    bomber_purple_up_0: ['assets/images/characters/bomber_purple/up_0.png'],
    bomber_purple_up_1: ['assets/images/characters/bomber_purple/up_1.png'],
    bomber_purple_left_0: ['assets/images/characters/bomber_purple/left_0.png'],
    bomber_purple_left_1: ['assets/images/characters/bomber_purple/left_1.png'],
    bomber_purple_right_0: ['assets/images/characters/bomber_purple/right_0.png'],
    bomber_purple_right_1: ['assets/images/characters/bomber_purple/right_1.png'],

    chen_down_0: ['assets/images/characters/chen/down_0.png'],
    chen_down_1: ['assets/images/characters/chen/down_1.png'],
    chen_up_0: ['assets/images/characters/chen/up_0.png'],
    chen_up_1: ['assets/images/characters/chen/up_1.png'],
    chen_left_0: ['assets/images/characters/chen/left_0.png'],
    chen_left_1: ['assets/images/characters/chen/left_1.png'],
    chen_right_0: ['assets/images/characters/chen/right_0.png'],
    chen_right_1: ['assets/images/characters/chen/right_1.png'],

    item_bomb_up: ['assets/images/items/item_bomb_up.png'],
    item_fire_up: ['assets/images/items/item_fire_up.png'],
    item_speed_up: ['assets/images/items/item_speed_up.png'],
    item_kick: ['assets/images/items/item_kick.png'],
    item_shield: ['assets/images/items/item_shield.png'],
  };

  /**
   * Dynamically registers image paths for all characters loaded from character.json folders
   */
  public registerCharacters(characters: CharacterInfo[]) {
    const dirs = ['down', 'up', 'left', 'right'] as const;
    for (const c of characters) {
      const folder = c.folder || c.charId;
      const base = `assets/images/characters/${folder}`;
      if (!this.assetManifest[`char_${c.charId}`]) {
        this.assetManifest[`char_${c.charId}`] = [`${base}/idle.png`];
      }
      if (!this.assetManifest[`portrait_${c.charId}`]) {
        this.assetManifest[`portrait_${c.charId}`] = [`${base}/portrait.png`, `${base}/idle.png`];
      }
      for (const dir of dirs) {
        for (const frame of [0, 1]) {
          const key = `${c.charId}_${dir}_${frame}`;
          if (!this.assetManifest[key]) {
            this.assetManifest[key] = [`${base}/${dir}_${frame}.png`];
          }
        }
      }
    }
  }

  public async loadAll(): Promise<void> {
    const promises = Object.entries(this.assetManifest).map(([key, urls]) => {
      return new Promise<void>((resolve) => {
        let index = 0;
        const tryNext = () => {
          if (index >= urls.length) {
            resolve();
            return;
          }

          const img = new Image();
          img.onload = () => {
            this.images.set(key as ImageKey, img);
            this.loaded.add(key as ImageKey);
            resolve();
          };
          img.onerror = () => {
            index++;
            tryNext();
          };
          img.src = urls[index];
        };
        tryNext();
      });
    });

    await Promise.all(promises);
  }

  public getImage(key: ImageKey): HTMLImageElement | null {
    if (this.loaded.has(key)) {
      return this.images.get(key) || null;
    }
    return null;
  }

  public hasImage(key: ImageKey): boolean {
    return this.loaded.has(key);
  }
}

export const assets = new AssetManager();
