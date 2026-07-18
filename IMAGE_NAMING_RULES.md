# 画像ファイル命名・配置ルール

このドキュメントは、Studio Nagoya Base Community の画像フォルダを整理し、  
**三本柱・用途・ページ・セクションがパスとファイル名だけで分かる状態**にするためのルールです。

---

## 1. 基本方針

画像は次の2段階で分類します。

1. **フォルダで「三本柱」と「ページ・企画」を示す**
2. **ファイル名で「セクション」と「用途」を示す**

命名形式は以下に統一します。

```text
images/{pillar}/{page}/{section}-{type}-{identifier}.{ext}
```

例：

```text
images/community/baseball-vol2/hero-photo-main.webp
images/portrait/top/gallery-photo-01.webp
images/baseball/catchball/meta-ogp-main.jpg
```

---

## 2. 三本柱

`images/` 直下は、以下の4フォルダに分けます。

```text
images/
├── baseball/
├── community/
├── portrait/
└── common/
```

### `baseball`

名古屋野球ユニ部、キャッチボール会、野球活動に使用する画像。

```text
images/baseball/
```

### `community`

SNB Communityの交流会、サカユニ会、野球ユニ撮影交流会などに使用する画像。

```text
images/community/
```

### `portrait`

男性ポートレート、撮影セッション、作品紹介に使用する画像。

```text
images/portrait/
```

### `common`

複数ページで共通使用する画像。

対象例：

- ブランドロゴ
- 共通アイコン
- 共通背景
- UI用画像
- サイト全体の共通装飾

```text
images/common/
```

---

## 3. 推奨フォルダ構成

```text
images/
├── common/
│   ├── brand/
│   └── ui/
│
├── baseball/
│   ├── top/
│   └── catchball/
│
├── community/
│   ├── top/
│   ├── soccer-vol1/
│   └── baseball-vol2/
│
└── portrait/
    └── top/
```

### フォルダ名の考え方

- `top`：各柱のトップページ
- `catchball`：キャッチボール会
- `soccer-vol1`：サカユニ会 Vol.1
- `baseball-vol2`：野球ユニ撮影交流会 Vol.2
- 今後の企画も同じ形式で追加する

例：

```text
community/soccer-vol3/
community/baseball-vol4/
baseball/practice-2026-09/
portrait/session-2026-08/
```

---

## 4. ファイル名の構造

```text
{section}-{type}-{identifier}.{ext}
```

例：

```text
hero-photo-main.webp
gallery-photo-01.webp
meta-ogp-main.jpg
feature-thumbnail-lighting.webp
```

---

## 5. セクション名

ページ内の掲載位置を示します。

| セクション名 | 用途 |
|---|---|
| `hero` | ファーストビュー、メインビジュアル |
| `about` | 概要、コンセプト紹介 |
| `feature` | 特徴、強み、設備紹介 |
| `gallery` | 作例、ギャラリー |
| `schedule` | 開催日程、スケジュール |
| `price` | 料金、プラン |
| `access` | アクセス、地図、建物案内 |
| `cta` | 予約・申込導線 |
| `meta` | OGP、SNS共有、検索表示用 |
| `brand` | ブランド要素 |
| `ui` | ボタン、アイコン、装飾 |

---

## 6. 用途名

画像が何として使われるかを示します。

| 用途名 | 用途 |
|---|---|
| `photo` | 通常写真、作例写真 |
| `background` | 背景画像 |
| `card` | カード型UI用画像 |
| `thumbnail` | サムネイル |
| `ogp` | OGP画像 |
| `icon` | アイコン |
| `logo` | ロゴ |
| `map` | 地図 |
| `diagram` | 図解 |
| `banner` | 告知バナー |

---

## 7. 識別子

同じセクション・用途の画像を区別します。

| 識別子 | 用途 |
|---|---|
| `main` | 主画像 |
| `desktop` | PC専用 |
| `mobile` | スマートフォン専用 |
| `01` `02` `03` | 連番 |
| `light` | 明るい配色 |
| `dark` | 暗い配色 |
| `before` | 変更前 |
| `after` | 変更後 |

連番は必ず2桁にします。

```text
gallery-photo-01.webp
gallery-photo-02.webp
gallery-photo-03.webp
```

以下は使用しません。

```text
gallery-photo-1.webp
gallery-photo-2.webp
```

---

## 8. 拡張子ルール

### WebP

サイト内で表示する通常画像の基本形式。

```text
.webp
```

対象：

- ヒーロー画像
- ギャラリー
- 設備写真
- サムネイル
- 背景画像

### JPG

OGPや、WebPが適さない外部サービス向け画像。

```text
.jpg
```

対象：

- OGP
- SNS共有画像
- 外部サービス登録用画像

### PNG

透過が必要な場合のみ使用。

```text
.png
```

対象：

- 透過ロゴ
- 透過アイコン
- 特殊な図版

### SVG

ロゴや単純なアイコンで使用可能な場合に推奨。

```text
.svg
```

---

## 9. 表記ルール

### 使用するもの

- 英小文字
- 半角数字
- ハイフン
- 2桁の連番

```text
hero-photo-main.webp
baseball-vol2
gallery-photo-01.webp
```

### 使用しないもの

- 日本語
- 空白
- アンダースコア
- 大文字
- カメラが自動生成した名前
- 意味の分からない略称

NG例：

```text
野球ユニ画像.jpg
IMG_8958.jpeg
hero_portrait.webp
OGP_Baseball.jpg
baseball hero.jpg
```

OK例：

```text
community/baseball-vol2/hero-photo-main.webp
portrait/top/hero-photo-main.webp
```

---

## 10. OGP画像のルール

OGP画像は必ず各ページのフォルダ内に置きます。

```text
images/{pillar}/{page}/meta-ogp-main.jpg
```

例：

```text
images/baseball/catchball/meta-ogp-main.jpg
images/community/top/meta-ogp-main.jpg
images/community/soccer-vol1/meta-ogp-main.jpg
images/community/baseball-vol2/meta-ogp-main.jpg
images/portrait/top/meta-ogp-main.jpg
```

ページ名や企画名をファイル名に重複して入れません。

NG：

```text
images/community/baseball-vol2/ogp-baseball-vol2-hero.jpg
```

OK：

```text
images/community/baseball-vol2/meta-ogp-main.jpg
```

フォルダ名ですでに対象ページが分かるため、ファイル名は用途だけを表します。

---

## 11. ヒーロー画像のルール

```text
images/{pillar}/{page}/hero-photo-main.webp
```

例：

```text
images/baseball/catchball/hero-photo-main.webp
images/community/top/hero-photo-main.webp
images/community/baseball-vol2/hero-photo-main.webp
images/portrait/top/hero-photo-main.webp
```

PCとスマートフォンで別画像を使用する場合：

```text
hero-photo-desktop.webp
hero-photo-mobile.webp
```

---

## 12. ギャラリー画像のルール

```text
images/{pillar}/{page}/gallery-photo-{number}.webp
```

例：

```text
images/portrait/top/gallery-photo-01.webp
images/portrait/top/gallery-photo-02.webp
images/portrait/top/gallery-photo-03.webp
```

写真の種類をさらに区別する必要がある場合：

```text
gallery-photo-white-01.webp
gallery-photo-dark-01.webp
gallery-photo-uniform-01.webp
```

ただし、分類が増えすぎる場合はサブフォルダ化を優先します。

```text
portrait/top/gallery/
├── white/
├── dark/
└── uniform/
```

---

## 13. 現在のファイル名からの変更例

| 現在 | 変更後 |
|---|---|
| `baseball-vol2-hero.webp` | `community/baseball-vol2/hero-photo-main.webp` |
| `baseball-vol2-hero.jpg` | 必要性を確認し、不要なら削除 |
| `ogp_baseball-vol2-hero.jpg` | `community/baseball-vol2/meta-ogp-main.jpg` |
| `catchball-ogp.jpg` | `baseball/catchball/meta-ogp-main.jpg` |
| `catchball.webp` | `baseball/catchball/hero-photo-main.webp` |
| `hero_portrait.webp` | `portrait/top/hero-photo-main.webp` |
| `ogp_community-hero.jpg` | `community/top/meta-ogp-main.jpg` |
| `ogp_community-hero.png` | 不要なら削除 |
| `ogp_community-hero.webp` | 不要なら削除 |
| `ogp_portrait_session.jpeg` | `portrait/top/meta-ogp-main.jpg` |
| `ogp_soccer-vol1-hero.jpg` | `community/soccer-vol1/meta-ogp-main.jpg` |
| `portrait_gallery_01.webp` | `portrait/top/gallery-photo-01.webp` |
| `portrait_gallery_02.webp` | `portrait/top/gallery-photo-02.webp` |
| `IMG_8958.jpeg` | 内容を確認し、用途に応じた名前へ変更 |

---

## 14. 重複ファイルの扱い

同じ画像が複数形式で存在する場合、用途を確認して整理します。

例：

```text
ogp_community-hero.jpg
ogp_community-hero.png
ogp_community-hero.webp
```

OGPにJPGしか使用していない場合は、以下だけ残します。

```text
community/top/meta-ogp-main.jpg
```

削除前に、HTML・CSS・JavaScript・README内の参照を検索します。

```bash
grep -R "ogp_community-hero" .
```

参照がないことを確認してから削除します。

---

## 15. HTML・CSSの参照更新

画像を移動・改名した場合は、必ず参照先も同時に変更します。

変更前：

```html
<img src="../images/baseball-vol2-hero.webp" alt="">
```

変更後：

```html
<img src="../images/community/baseball-vol2/hero-photo-main.webp" alt="">
```

OGP：

```html
<meta property="og:image"
      content="https://nagoya-base.github.io/snb-community/images/community/baseball-vol2/meta-ogp-main.jpg">
```

CSS：

```css
background-image: url("../images/community/top/hero-background-main.webp");
```

---

## 16. 画像追加時のチェックリスト

新しい画像を追加する前に確認します。

- [ ] 三本柱のどれに属するか決めた
- [ ] 対象ページ・企画フォルダを決めた
- [ ] セクション名を決めた
- [ ] 用途名を決めた
- [ ] 英小文字とハイフンのみで命名した
- [ ] 連番を2桁にした
- [ ] 通常画像はWebPにした
- [ ] OGPはJPGにした
- [ ] 既存画像との重複がない
- [ ] HTML・CSSの参照先を更新した
- [ ] PCとスマートフォンで表示確認した
- [ ] OGP表示を確認した

---

## 17. 完成形の例

```text
images/
├── common/
│   ├── brand/
│   │   ├── brand-logo-main.svg
│   │   └── brand-logo-mark.svg
│   └── ui/
│       └── ui-icon-menu.svg
│
├── baseball/
│   ├── top/
│   │   ├── hero-photo-main.webp
│   │   └── meta-ogp-main.jpg
│   └── catchball/
│       ├── hero-photo-main.webp
│       ├── gallery-photo-01.webp
│       ├── gallery-photo-02.webp
│       └── meta-ogp-main.jpg
│
├── community/
│   ├── top/
│   │   ├── hero-photo-main.webp
│   │   └── meta-ogp-main.jpg
│   ├── soccer-vol1/
│   │   ├── hero-photo-main.webp
│   │   └── meta-ogp-main.jpg
│   └── baseball-vol2/
│       ├── hero-photo-main.webp
│       └── meta-ogp-main.jpg
│
└── portrait/
    └── top/
        ├── hero-photo-main.webp
        ├── gallery-photo-01.webp
        ├── gallery-photo-02.webp
        ├── gallery-photo-03.webp
        └── meta-ogp-main.jpg
```

---

## 18. 最重要ルール

画像パスを見たときに、以下の4点が分かる状態を維持します。

1. どの三本柱か
2. どのページ・企画か
3. どのセクションで使うか
4. 何の用途の画像か

例：

```text
images/community/baseball-vol2/hero-photo-main.webp
```

このパスから以下が判断できます。

- 三本柱：Community
- 企画：野球ユニ撮影交流会 Vol.2
- セクション：ヒーロー
- 用途：メイン写真
