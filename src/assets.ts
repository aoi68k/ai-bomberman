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
  | 'item_bomb_up'
  | 'item_fire_up'
  | 'item_speed_up'
  | 'item_kick'
  | 'item_shield';

export class AssetManager {
  private images: Map<ImageKey, HTMLImageElement> = new Map();
  private loaded: Set<ImageKey> = new Set();

  /**
   * Defines file paths for each image resource inside public/assets/images/
   */
  private assetManifest: Record<ImageKey, string> = {
    wall: '/assets/images/wall.png',
    soft_block: '/assets/images/soft_block.png',
    floor: '/assets/images/floor.png',
    bomb: '/assets/images/bomb.png',
    player_0: '/assets/images/player_0.png', // P1 (You)
    player_1: '/assets/images/player_1.png', // COM 1 (Black)
    player_2: '/assets/images/player_2.png', // COM 2 (Red)
    player_3: '/assets/images/player_3.png', // COM 3 (Green)
    item_bomb_up: '/assets/images/item_bomb_up.png',
    item_fire_up: '/assets/images/item_fire_up.png',
    item_speed_up: '/assets/images/item_speed_up.png',
    item_kick: '/assets/images/item_kick.png',
    item_shield: '/assets/images/item_shield.png',
  };

  public async loadAll(): Promise<void> {
    const promises = Object.entries(this.assetManifest).map(([key, url]) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.images.set(key as ImageKey, img);
          this.loaded.add(key as ImageKey);
          resolve();
        };
        img.onerror = () => {
          // File not found or not yet placed by user - silently fallback
          resolve();
        };
        img.src = url;
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
