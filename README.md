# Studio Nagoya Base Community

名古屋・上前津を拠点に活動する、3つのゆるいコミュニティサイトです。

🌐 **公開URL:** https://nagoya-base.github.io/snb-community/

---

## 3つの活動

| 柱 | テーマカラー | 概要 |
|---|---|---|
| ⚾ [名古屋野球ユニ部](baseball/) | 緑 `#3A7D44` | 野球ユニフォームを着てゆるくキャッチボール。未経験・1人参加歓迎のサークル |
| 👕 [SNBコミュニティ](community/) | 赤 `#C62828` | お気に入りの衣装を着て集まる少人数の交流撮影会。不定期開催 |
| 📷 [ポートレート体験](portrait/) | 青 `#1976D2` | 撮影経験ゼロから参加できるポートレートセッション |

---

## ディレクトリ構成

```
snb-community/
├── index.html              # トップページ（3柱ハブ）
├── common.css              # 全ページ共通スタイル・CSS変数
├── baseball/               # 名古屋野球ユニ部
│   ├── index.html
│   ├── items.html          # ユニフォーム一覧
│   └── style.css
├── community/              # SNBコミュニティ
│   ├── index.html
│   ├── vol1_0704_soccer.html  # イベント個別ページ
│   └── style.css
├── portrait/               # ポートレート体験
│   ├── index.html
│   ├── photographer.html   # カメラマン向け案内
│   └── style.css
├── images/                 # 画像（WebP中心・OGP用JPEGあり）
├── robots.txt
├── sitemap.xml
└── REVIEW_CHECKLIST.md     # コードレビュー観点チェックリスト
```

---

## 技術スタック

- **静的サイト:** HTML / CSS / JavaScript（ビルドなし）
- **ホスティング:** GitHub Pages（`.nojekyll` で Jekyll 無効）
- **CSS設計:** CSS カスタムプロパティ（変数）で各柱のアクセントカラーを管理
- **画像:** WebP 形式（OGP・ヒーローのフォールバックは JPEG）

---

## 開発ルール

- `common.css` に共通スタイル・CSS変数を定義。ハードコード色の追加禁止
- Jekyll 無効のため、HTML の先頭に front matter（`---`）を追加しない
- 緊縛事業（ataru-nagoya）へのリンクをこのサイト内に追加しない
- OGP 画像は JPEG、ヒーロー画像は `<picture>` 要素で WebP 優先
- コードレビュー観点は `REVIEW_CHECKLIST.md` を参照

---

## 関連リポジトリ

| リポジトリ | 用途 |
|---|---|
| [Studio-nagoya-base](https://github.com/nagoya-base/Studio-nagoya-base) | SNB 緊縛スタジオ + Studio X |
| [ataru-nagoya](https://github.com/nagoya-base/ataru-nagoya) | アタル 緊縛・ロープセッション（成人向け） |
