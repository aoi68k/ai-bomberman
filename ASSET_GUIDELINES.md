# AI Bomber 画像アセット作成ガイドライン (Asset Creation Guidelines) 🎨

このドキュメントは、AI画像生成ツール（Midjourney、DALL-E、Stable Diffusion、その他チャットAI）やドット絵エディタで「AI Bomber」用の画像アセットを作成・差し替えるための公式仕様書・プロンプトテンプレート集です。

---

## 📐 基本仕様 (Technical Specifications)

| 項目 | 仕様 | 備考 |
| :--- | :--- | :--- |
| **ファイル形式** | **PNG** (アルファチャンネル付き透過PNG推奨) | 背景は必ず透明(transparent)にしてください |
| **解像度（基準）** | **48 × 48 px** (1マス) | 96×96 px や 128×128 px の正方形でも可（ゲーム側で自動等倍スケーリング） |
| **縦横比** | **1 : 1 (正方形)** | |
| **視点・アングル** | **Top-Down / 3/4 Isometric Retro Arcade (見下ろし斜め視点)** | クラシックなアーケード/SFC風見下ろしアングル |
| **スタイル** | 16-bit / 32-bit レトロピクセルアート、またはクッキリしたフラットベクター | 輪郭線がくっきりしたデザインが背景で埋もれず視認性抜群です |

---

## 📁 ディレクトリ構造 (Folder Structure)

画像はキャラクターごと、環境ごとに整理されたフォルダに配置します。

```text
public/assets/images/
├── characters/
│   ├── bomber_blue/           # キャラ1: ボンバーブルー（スタンダード）
│   │   ├── idle.png           # 立ち絵（待機・正面）
│   │   ├── walk.png           # 移動時画像（左右反転対応）
│   │   ├── portrait.png       # キャラ選択画面用アイコン (64x64 or 128x128)
│   │   └── skill_icon.png     # スキルアイコン
│   ├── bomber_black/          # キャラ2: ボンバーブラック（スピードスター）
│   │   ├── idle.png
│   │   ├── walk.png
│   │   ├── portrait.png
│   │   └── skill_icon.png
│   ├── bomber_red/            # キャラ3: ボンバーレッド（パワーファイター）
│   │   ├── idle.png
│   │   ├── walk.png
│   │   ├── portrait.png
│   │   └── skill_icon.png
│   └── bomber_green/          # キャラ4: ボンバーグリーン（トリッキー・ディフェンダー）
│       ├── idle.png
│       ├── walk.png
│       ├── portrait.png
│       └── skill_icon.png
├── environment/
│   ├── wall.png               # 壊せない壁（ハードブロック）
│   ├── soft_block.png         # 壊せるブロック（レンガ・木箱）
│   └── floor.png              # 地面タイル
└── items/
    ├── bomb.png               # 爆弾
    ├── item_bomb_up.png       # ボムUP
    ├── item_fire_up.png       # 火力UP
    ├── item_speed_up.png      # 速度UP
    ├── item_kick.png          # ボムキック
    └── item_shield.png        # シールド
```

---

## ⚡ キャラクター固有技（スキル）仕様一覧

ゲーム開始前の**キャラクター選択画面**で以下の4人から選択できます。コントローラーの **Xボタン** または キーボードの **E / Shiftキー** で固有技を発動できます（クールダウン制）。

| キャラID | 名前 | 特徴 | 固有技名 | 固有技効果 | クールダウン |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `bomber_blue` | **ブルー (Blue)** | オールラウンダー | **ダッシュ (Dash)** | 瞬間的に2マス前方へ高速ダッシュ。爆風からの緊急脱出に最適 | 8秒 |
| `bomber_black` | **ブラック (Black)** | アグレッシブ | **リモコンボム (Remote Detonate)** | 最後に置いた自分のボムを好きなタイミングで遠隔起爆 | 10秒 |
| `bomber_red` | **レッド (Red)** | パワフル | **パワーボム (Mega Bomb)** | 次に置くボムが周囲のソフトブロックを貫通する巨大火炎ボムになる | 14秒 |
| `bomber_green` | **グリーン (Green)** | テクニカル | **バリア生成 (Shield Deploy)** | 3秒間持続する爆風ガードシールドを即座に1枚展開 | 16秒 |

---

## 🤖 他チャット用 AI画像生成プロンプトテンプレート

ChatGPTやMidjourney等で画像を生成する際は、以下のプロンプトをそのままコピー＆ペーストして使えます。

### 1. キャラクター用テンプレート (Prompt for Characters)
```text
16-bit pixel art sprite of a cute retro bomberman character wearing a [COLOR] helmet with a pink antenna pom-pom, [COLOR] bomber suit, white visor with cute blue eyes, facing front, top-down arcade game perspective, isolated on pure solid black background (or transparent background), clean outline, 48x48 pixel art, no dithering, retro game asset --no text, shadows, realistic lighting
```
* **Blue**: `[COLOR]` を `bright blue` に置換
* **Black**: `[COLOR]` を `dark charcoal and red visor accents` に置換
* **Red**: `[COLOR]` を `vibrant crimson red` に置換
* **Green**: `[COLOR]` を `emerald green with yellow visor accents` に置換

### 2. キャラ選択用アイコン (Portrait)
```text
16-bit pixel art close-up avatar icon portrait of a cute retro bomberman character wearing a [COLOR] helmet, arcade fighting game character select screen style, clean crisp pixel edges, square frame, high contrast retro colors --no text
```

### 3. 壁・ブロック・床用テンプレート (Prompt for Tiles)
- **壊せない壁 (`wall.png`)**:
  ```text
  16-bit pixel art of an indestructible dark metallic industrial tech wall block, top-down grid game tile, seamless 48x48 square, metallic bevel borders, subtle gold rivets on corners, clean retro arcade sprite --no shadows, background
  ```
- **壊せるレンガ (`soft_block.png`)**:
  ```text
  16-bit pixel art of a destructible clay brick block, top-down view for arcade bomber maze game, warm orange and brown brick pattern with dark mortar lines, 48x48 square sprite, crisp retro game asset
  ```
- **床タイル (`floor.png`)**:
  ```text
  16-bit pixel art seamless floor tile for retro arcade battle arena, dark slate blue minimal grid texture, subtle square bevel edge, 48x48 tileable texture
  ```
- **ボム (`bomb.png`)**:
  ```text
  16-bit pixel art of a cute spherical cartoon bomb with a burning fuse with yellow sparks, classic arcade style, dark glossy sphere with white highlight shine, isolated transparent background, 48x48
  ```

---

## 🛠️ 画像の取り込み手順

1. 他チャットや画像編集ソフトで画像を生成・作成します。
2. 48×48 px（または正方形）で保存します。
3. `public/assets/images/characters/[各キャラフォルダ]/idle.png` や `public/assets/images/environment/` に配置・上書き保存します。
4. ゲームを再読み込みすると、自動的に新しい画像が反映されます！
