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
├── contact/                # 共通問い合わせフォーム（3柱共通の一般質問・相談窓口）
│   ├── index.html
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

## アクセス解析（Google Analytics 4）

全ページに GA4 のトラッキングコード（測定 ID: `G-8K1TJG0S9Y`）を設定しています。
共通の計測ヘルパーは `analytics.js`（`window.SNBAnalytics`）です。

### GA4 管理画面でキーイベントとして ON にするもの

| イベント名 | 発火条件 |
| --- | --- |
| `entry_submit` | 参加申込フォームの POST が**成功した時だけ** 1 回 |

設定手順：GA4 管理画面 →「管理」→「データの表示」→「イベント」→ 一覧から
`entry_submit` を探し、「キーイベントとしてマークを付ける」を ON にします。
イベントが一覧に表示されるのは、実際に 1 回以上計測された後です（最大 24 時間程度）。

`entry_submit` は `SNBAnalytics.trackEntrySubmit()` からのみ送信され、
以下では発火しません。

- 送信ボタンを押しただけの時
- 必須項目の未入力など、バリデーションエラーがある時
- 送信を試みたがサーバー・通信エラーで失敗した時（`submit_failed` を送信）

二重計測は、送信操作ごとに採番するトークンで防いでいます。

複数の開催回は `event_slug` / `event_title` で判別します。値は各ページの
`<body data-event-slug="..." data-event-title="...">` から自動的に付与されます。
新しい開催ページを追加するときは、この 2 属性と `analytics.js` の読み込みを
忘れないでください。

### 実装していない成果イベント

| イベント名 | 実装しない理由 |
| --- | --- |
| `entry_complete` | 申込完了ページが存在しない。送信成功と完了メッセージの表示が同一の瞬間に起きるため、`entry_submit` と両方送ると 1 件の申込を二重に計上することになる |

将来、申込完了を独立したページやステップとして用意した場合に、はじめて実装してください。

### 匿名アンケート（Vol.3）の扱い

`community/vol3_uniform.html` の匿名アンケートは、回答しても参加確定・
お申し込みにはなりません。そのため送信成功時も `entry_submit` は発火させず、
分析用イベント `survey_submit` を送信します。

### 分析用イベント（キーイベントにしない）

`page_view` / `scroll` / `form_start` / `form_error` / `submit_failed` /
`survey_submit` / `portrait_form_view` / `portrait_form_start` /
`portrait_form_plan_select` / `portrait_form_submit_booking` /
`portrait_form_submit_consult` / `portrait_form_success` / `portrait_form_error` /
`portrait_select_contact_type` / `portrait_view_*` / `portrait_click_*` /
`portrait_toggle_gallery` / `contact_form_view` / `contact_form_start` /
`contact_form_submit` / `contact_form_success` / `contact_form_error` /
`contact_link_click`

### 共通パラメータ

個人情報（氏名・年代・メールアドレス・Xアカウント・希望ユニフォーム・
自己紹介・備考）は一切送信しません。送信するのはカテゴリ値のみです。

- `site_section`：`community` / `portrait` / `baseball`
- `page_path`：`location.pathname`
- `event_slug` / `event_title`：開催回の識別（`<body>` の data 属性から）
- `form_name`：`vol4_apply_form` / `vol3_survey_form` など

### 発火確認の手順

1. 確認したいページを `?debug_mode=true` 付きで開きます
   （例：`https://nagoya-base.github.io/snb-community/community/vol4_0812_soccer_track.html?debug_mode=true`）
2. ブラウザの開発者ツールのコンソールに `[SNBAnalytics]` から始まるログが出力され、
   イベント名とパラメータを確認できます
3. GA4 管理画面 →「管理」→「DebugView」でも同じイベントをリアルタイムに確認できます
4. `entry_submit` は、実際にフォームを送信して完了メッセージが表示されるところまで
   確認してください。必須項目を空にして送信ボタンを押しても発火しないことも
   合わせて確認します

`file://` での直接表示と `localhost` では、誤計測を防ぐため送信されません
（`?debug_mode=true` を付けた場合を除く）。

---

## 関連リポジトリ

| リポジトリ | 用途 |
|---|---|
| [Studio-nagoya-base](https://github.com/nagoya-base/Studio-nagoya-base) | SNB 緊縛スタジオ + Studio X |
| [ataru-nagoya](https://github.com/nagoya-base/ataru-nagoya) | アタル 緊縛・ロープセッション（成人向け） |
