// Asset Loader for custom PNG/SVG/WebP images
// If an image is not provided or fails to load, gracefully falls back to programmatic drawing.

export type ImageKey =
  | 'wall'
  | 'soft_block'
  | 'floor'
  | 'bomb'
  | 'player_0'
  | 'player_1'
  | 'player_2'
  | 'player_3'
  | 'char_bomber_blue'
  | 'char_bomber_black'
  | 'char_bomber_red'
  | 'char_bomber_green'
  | 'portrait_bomber_blue'
  | 'portrait_bomber_black'
  | 'portrait_bomber_red'
  | 'portrait_bomber_green'
  | 'item_bomb_up'
  | 'item_fire_up'
  | 'item_speed_up'
  | 'item_kick'
  | 'item_shield';

import { DEFAULT_IMAGE_BASE64 } from './defaultImages';

export class AssetManager {
  private images: Map<ImageKey, HTMLImageElement> = new Map();
  private loaded: Set<ImageKey> = new Set();

  /**
   * Defines candidate file paths for each image resource
   */
  private assetManifest: Record<ImageKey, string[]> = {
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
