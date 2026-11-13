# AI Bomber 画像・キャラクター作成ガイドライン (Asset & Character Guidelines) 🎨

このドキュメントは、AI画像生成ツール（Midjourney、DALL-E、Stable Diffusion、その他チャットAI）やドット絵エディタで「AI Bomber」用の画像アセットを作成・差し替えたり、新しいキャラクターを追加するための公式仕様書・プロンプトテンプレート集です。

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

画像は `public/assets/images/` 配下にキャラクターごと・環境ごとに整理されています。
特に `characters/<キャラID>/character.json` を配置するだけで、ゲーム起動時に自動でキャラクター一覧に読み込まれます。

```text
public/
├── og-preview.png               # 通常リンク共有用OGP画像 (1200×630)
├── og-invite.png                # マルチプレイ招待リンク用OGP画像 (1200×360 横長バナー)
└── assets/images/
    ├── characters/
    │   ├── bomber_blue/         # キャラ1: ボンバーブルー（オールラウンダー）
    │   │   ├── character.json           # キャラ定義・ステータス・スキル設定ファイル
    │   │   ├── down_0.png, down_1.png   # 正面（下）歩行モーション 2コマ
    │   │   ├── up_0.png, up_1.png       # 背面（上）歩行モーション 2コマ
    │   │   ├── left_0.png, left_1.png   # 左向き歩行モーション 2コマ
    │   │   ├── right_0.png, right_1.png # 右向き歩行モーション 2コマ
    │   │   ├── idle.png                 # 待機・共通フォールバック画像
    │   │   └── portrait.png             # キャラ選択・HUD用顔アイコン (64x64 or 128x128)
    │   ├── bomber_black/        # キャラ2: ボンバーブラック（スピードスター）
    │   ├── bomber_red/          # キャラ3: ボンバーレッド（パワーファイター）
    │   ├── bomber_green/        # キャラ4: ボンバーグリーン（ディフェンダー）
    │   ├── bomber_purple/       # キャラ5: ボンバーパープル（ストライカー）
    │   ├── chen/                # キャラ6: チェン（龍剣士）
    │   └── yangyang/            # キャラ7: 秧秧（疾風 / 連撃）
    ├── environment/
    │   ├── wall.png             # 壊せない壁（ハードブロック）
    │   ├── soft_block.png       # 壊せるブロック（レンガ・木箱）
    │   └── floor.png            # 地面タイル
    └── items/
        ├── bomb.png             # 爆弾
        ├── item_bomb_up.png     # ボムUP
        ├── item_fire_up.png     # 火力UP
        ├── item_speed_up.png    # 速度UP
        ├── item_kick.png        # ボムキック
        └── item_shield.png      # シールド（バリア）
```

---

## ⚡ キャラクター固有技（スキル）＆ 超技（必殺技）仕様一覧

- **固有技（スキル）**: コントローラーの **Xボタン** または キーボードの **E / Shiftキー** で発動（クールダウン制）。
- **超技（必殺技）**: ボムを10個設置して超技ゲージが100%になると、コントローラーの **Y / LBボタン** または キーボードの **Q / Cキー** で発動可能。
- **連爆（Chain Bomb）**: フィールド上の「⚡💣 連爆」アイテムを取得すると、**ボムボタン2連打**（またはスキルボタン）で前方へ最大4個まで時間差連鎖ボムを一列設置できます。

| キャラID | 名前 | ロール | 固有技 (CD) | 固有技効果 | 超技（必殺技） | 超技効果 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `bomber_blue` | **ボンバーブルー** | オールラウンダー | **ダッシュ** (8秒) | 向いている方向へ素早く2マス突進し、爆風を緊急回避 | **閃光ダッシュ** | 前方3マスへ高速ワープ＆1秒間無敵！ |
| `bomber_black` | **ボンバーブラック** | スピードスター | **リモコン起爆** (10秒) | 直前に置いた自分のボムを好きなタイミングで遠隔爆破 | **一斉起爆** | 設置中の自分のボムすべてを即座に大爆発させる！ |
| `bomber_red` | **ボンバーレッド** | パワーファイター | **メガボム** (12秒) | 次回置くボムが火力+4（最大8）の赤金オーラ付き強化ボムになる | **ノヴァボム** | 最大火力8の超特大メガボムを足元に即時展開！ |
| `bomber_green` | **ボンバーグリーン** | ディフェンダー | **緊急シールド** (15秒) | 爆風を防ぐエネルギーシールドを即座に1枚展開（最大2枚） | **フォートレス** | シールド2枚展開＆2秒間完全無敵状態になる！ |
| `bomber_purple` | **ボンバーパープル** | ストライカー | **スタンタックル** (10秒) | 前方2マスへ突進し、衝突した相手を3秒間スタン（気絶）させる | **メテオタックル** | 前方3マスへ貫通猛突進！当たった敵を4秒間スタンさせる |
| `chen` | **チェン (Chen)** | 龍剣士 | **二連斬り突進** (10秒) | 前方0〜1マスに二連斬撃後、2マス斬撃突進（命中時3秒スタン） | **龍閃乱れ斬り** | 連続斬撃を繰り出しながら前方4マス突進（命中時3秒スタン） |
| `yangyang` | **秧秧 (Yangyang)** | 疾風 / 連撃 | **風鳴乱舞** (8秒) | 前方2マスへ乱れ斬りの風刃を飛ばす（命中時2秒スタン） | **疾風万刃域** | 前方1マス先を中心に3×3マスの乱れ斬エリアを4秒間展開（2秒スタン） |

---

## 🧩 `character.json` によるキャラクター追加・編集方法

`public/assets/images/characters/<任意のフォルダ名>/character.json` を作成すると、コードを変更することなくキャラクターのステータスやテキストを調整できます。

```json
{
  "charId": "chen",
  "name": "Chen",
  "jpName": "チェン",
  "role": "龍剣士",
  "color": "#0284c7",
  "subColor": "#f8fafc",
  "accentColor": "#38bdf8",
  "stats": {
    "initialBombs": 1,
    "initialPower": 2,
    "initialSpeed": 2.6
  },
  "skillType": "CHEN_SLASH_RUSH",
  "skillName": "二連斬り突進 (Slash Rush)",
  "skillDesc": "前方0～1マスに2回斬撃ののち、0～2マス斬撃しながら突進（3秒スタン）",
  "skillCooldown": 600,
  "ultraType": "CHEN_TEMPEST_RUSH",
  "ultraName": "龍閃乱れ斬り (Tempest)",
  "ultraDesc": "斬撃乱れ斬をしながら前方4マス突進！斬撃を受けた敵を3秒スタン",
  "ultraCooldown": 1200
}
```

---

## 🤖 AI画像生成プロンプトテンプレート

ChatGPTやMidjourney等で画像を生成する際は、以下のプロンプトをそのままコピー＆ペーストして使えます。

### 1. キャラクター用テンプレート (Prompt for Characters)
```text
16-bit pixel art sprite of a cute retro bomberman character wearing a [COLOR] helmet with a pink antenna pom-pom, [COLOR] bomber suit, white visor with cute blue eyes, [DIRECTION_AND_POSE], top-down arcade game perspective, isolated on transparent background, clean outline, 48x48 pixel art, no dithering, retro game asset --no text, shadows, realistic lighting
```
* **カラー置換**:
  * **Blue**: `[COLOR]` を `bright blue` に置換
  * **Black**: `[COLOR]` を `dark charcoal and red visor accents` に置換
  * **Red**: `[COLOR]` を `vibrant crimson red` に置換
  * **Green**: `[COLOR]` を `emerald green with yellow visor accents` に置換
  * **Purple**: `[COLOR]` を `royal purple with gold accents and pink antenna` に置換
* **方向・ポーズ置換 `[DIRECTION_AND_POSE]`**:
  * **下向き（正面）**:
    * `down_0.png`: `facing front, neutral standing pose, left foot slightly forward`
    * `down_1.png`: `facing front, walking motion pose, right foot slightly forward`
  * **上向き（背面）**:
    * `up_0.png`: `facing away from camera / back view, rear of helmet visible, left foot forward`
    * `up_1.png`: `facing away from camera / back view, rear of helmet visible, right foot forward`
  * **左向き**:
    * `left_0.png`: `facing left side profile, walking motion frame 1`
    * `left_1.png`: `facing left side profile, walking motion frame 2`
  * **右向き**:
    * `right_0.png`: `facing right side profile, walking motion frame 1`
    * `right_1.png`: `facing right side profile, walking motion frame 2`

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

1. AI画像生成ツールや画像編集ソフトで画像を生成・作成します。
2. 48×48 px（または正方形の透過PNG）で保存します。
3. `public/assets/images/characters/[各キャラフォルダ]/` や `public/assets/images/environment/` に配置・上書き保存します。
4. ゲームを再読み込みすると、自動的に新しい画像が反映されます。
