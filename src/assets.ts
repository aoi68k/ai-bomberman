// Asset Loader for custom PNG/SVG/WebP images
// If an image is not provided or fails to load, gracefully falls back to programmatic drawing.

export type ImageKey = string;

import { DEFAULT_IMAGE_BASE64 } from './defaultImages';

export class AssetManager {
  private images: Map<string, HTMLImageElement> = new Map();
  private loaded: Set<string> = new Set();

  /**
   * Defines candidate file paths for each image resource
   */
  private assetManifest: Record<string, string[]> = {
    wall: ['/assets/images/environment/wall.png', '/assets/images/wall.png', 'assets/images/environment/wall.png'],
    soft_block: ['/assets/images/environment/soft_block.png', '/assets/images/soft_block.png', 'assets/images/environment/soft_block.png'],
    floor: ['/assets/images/environment/floor.png', '/assets/images/floor.png', 'assets/images/environment/floor.png'],
    bomb: ['/assets/images/items/bomb.png', '/assets/images/bomb.png', 'assets/images/items/bomb.png'],

    player_0: ['/assets/images/characters/bomber_blue/idle.png', '/assets/images/player_0.png'],
    player_1: ['/assets/images/characters/bomber_black/idle.png', '/assets/images/player_1.png'],
    player_2: ['/assets/images/characters/bomber_red/idle.png', '/assets/images/player_2.png'],
    player_3: ['/assets/images/characters/bomber_green/idle.png', '/assets/images/player_3.png'],

    char_bomber_blue: ['/assets/images/characters/bomber_blue/idle.png', '/assets/images/player_0.png'],
    char_bomber_black: ['/assets/images/characters/bomber_black/idle.png', '/assets/images/player_1.png'],
    char_bomber_red: ['/assets/images/characters/bomber_red/idle.png', '/assets/images/player_2.png'],
    char_bomber_green: ['/assets/images/characters/bomber_green/idle.png', '/assets/images/player_3.png'],

    portrait_bomber_blue: ['/assets/images/characters/bomber_blue/portrait.png', '/assets/images/characters/bomber_blue/idle.png'],
    portrait_bomber_black: ['/assets/images/characters/bomber_black/portrait.png', '/assets/images/characters/bomber_black/idle.png'],
    portrait_bomber_red: ['/assets/images/characters/bomber_red/portrait.png', '/assets/images/characters/bomber_red/idle.png'],
    portrait_bomber_green: ['/assets/images/characters/bomber_green/portrait.png', '/assets/images/characters/bomber_green/idle.png'],

    // Directional Walk Motions (4-directions x 2-frames for 4 characters)
    bomber_blue_down_0: ['/assets/images/characters/bomber_blue/down_0.png'],
    bomber_blue_down_1: ['/assets/images/characters/bomber_blue/down_1.png'],
    bomber_blue_up_0: ['/assets/images/characters/bomber_blue/up_0.png'],
    bomber_blue_up_1: ['/assets/images/characters/bomber_blue/up_1.png'],
    bomber_blue_left_0: ['/assets/images/characters/bomber_blue/left_0.png'],
    bomber_blue_left_1: ['/assets/images/characters/bomber_blue/left_1.png'],
    bomber_blue_right_0: ['/assets/images/characters/bomber_blue/right_0.png'],
    bomber_blue_right_1: ['/assets/images/characters/bomber_blue/right_1.png'],

    bomber_black_down_0: ['/assets/images/characters/bomber_black/down_0.png'],
    bomber_black_down_1: ['/assets/images/characters/bomber_black/down_1.png'],
    bomber_black_up_0: ['/assets/images/characters/bomber_black/up_0.png'],
    bomber_black_up_1: ['/assets/images/characters/bomber_black/up_1.png'],
    bomber_black_left_0: ['/assets/images/characters/bomber_black/left_0.png'],
    bomber_black_left_1: ['/assets/images/characters/bomber_black/left_1.png'],
    bomber_black_right_0: ['/assets/images/characters/bomber_black/right_0.png'],
    bomber_black_right_1: ['/assets/images/characters/bomber_black/right_1.png'],

    bomber_red_down_0: ['/assets/images/characters/bomber_red/down_0.png'],
    bomber_red_down_1: ['/assets/images/characters/bomber_red/down_1.png'],
    bomber_red_up_0: ['/assets/images/characters/bomber_red/up_0.png'],
    bomber_red_up_1: ['/assets/images/characters/bomber_red/up_1.png'],
    bomber_red_left_0: ['/assets/images/characters/bomber_red/left_0.png'],
    bomber_red_left_1: ['/assets/images/characters/bomber_red/left_1.png'],
    bomber_red_right_0: ['/assets/images/characters/bomber_red/right_0.png'],
    bomber_red_right_1: ['/assets/images/characters/bomber_red/right_1.png'],

    bomber_green_down_0: ['/assets/images/characters/bomber_green/down_0.png'],
    bomber_green_down_1: ['/assets/images/characters/bomber_green/down_1.png'],
    bomber_green_up_0: ['/assets/images/characters/bomber_green/up_0.png'],
    bomber_green_up_1: ['/assets/images/characters/bomber_green/up_1.png'],
    bomber_green_left_0: ['/assets/images/characters/bomber_green/left_0.png'],
    bomber_green_left_1: ['/assets/images/characters/bomber_green/left_1.png'],
    bomber_green_right_0: ['/assets/images/characters/bomber_green/right_0.png'],
    bomber_green_right_1: ['/assets/images/characters/bomber_green/right_1.png'],

    item_bomb_up: ['/assets/images/items/item_bomb_up.png'],
    item_fire_up: ['/assets/images/items/item_fire_up.png'],
    item_speed_up: ['/assets/images/items/item_speed_up.png'],
    item_kick: ['/assets/images/items/item_kick.png'],
    item_shield: ['/assets/images/items/item_shield.png'],
  };

  public async loadAll(): Promise<void> {
    const promises = Object.entries(this.assetManifest).map(([key, urls]) => {
      return new Promise<void>((resolve) => {
        let index = 0;
        const tryNext = () => {
          if (index >= urls.length) {
            // Check if we have embedded default base64 PNG
            const b64 = DEFAULT_IMAGE_BASE64[key];
            if (b64) {
              const b64Img = new Image();
              b64Img.onload = () => {
                this.images.set(key as ImageKey, b64Img);
                this.loaded.add(key as ImageKey);
                resolve();
              };
              b64Img.onerror = () => resolve();
              b64Img.src = b64;
            } else {
              resolve();
            }
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
