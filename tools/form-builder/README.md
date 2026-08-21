# form-builder（フォームジェネレーター管理画面）

イベント応募フォーム・開催日アンケート・企画クロス集計アンケートを、テンプレート選択→
入力→プレビュー→PR作成の流れでブラウザから生成する運営内部用ツールです。
Issue #256 のMVP実装です。

このページは公開サイトの通常ナビゲーションには掲載していません。運営者が直接URLを
開いて使用します。

```
tools/form-builder/
├── index.html          管理画面（ウィザードUIの入れ物）
├── app.js               ウィザードの状態管理・画面描画
├── style.css             管理画面自体のスタイル（公開サイトのcommon.cssには依存しない）
├── lib/
│   ├── util.js            共通ユーティリティ（日付整形・エスケープ・base64等）
│   ├── validate.js        PR作成前バリデーション（＝設定JSONスキーマの実質定義）
│   ├── render.js          設定JSON → 公開用HTML文字列（プレビューと生成物が同じ関数を通る）
│   └── github.js          ブラウザから叩くGitHub REST APIクライアント
└── templates/
    ├── event-entry.json      「9/12教室セット撮影会」相当のプリセット
    ├── date-survey.json      「9月キャッチボール会アンケート」相当のプリセット
    └── cross-tab-survey.json 「9月企画アンケート」相当のプリセット
```

ビルド工程はありません（他のページと同様、素のHTML/CSS/JSをGitHub Pagesがそのまま配信します）。

---

## 使い方（運営者向け）

1. `tools/form-builder/index.html` をブラウザで開く
   - **ローカルで動作確認する場合は簡易HTTPサーバー経由で開いてください**
     （例: リポジトリ直下で `python3 -m http.server` → `http://localhost:8000/tools/form-builder/`）。
     `file://` で直接開くとテンプレートJSONの`fetch`がブラウザのCORS制限で失敗します。
     GitHub Pagesで公開されたURLを開く場合はこの制約はありません。
2. 「1. テンプレート」でフォーム種別を選ぶか、「前回を複製」で代表フォームのプリセットを読み込む
3. 「2. 基本情報」〜「5. 連絡先/GAS/計測」で内容を編集する
4. 「6. プレビュー」で実際に生成されるページを確認する（390px/デスクトップ幅切替、受付終了表示確認）
   - プレビュー画面はどの操作をしてもGAS送信・GA4送信を一切行いません
5. 「7. PR作成」でGitHub Personal Access Tokenと作業ブランチ名を入力し、「PRを作成」を押す
6. 作成されたPRを人間が確認し、問題なければmergeする（**このツールはauto-mergeしません**）
7. GAS Web AppのURLが未確定だった場合、Google側で手動デプロイを行い、URLが決まったら
   `<section>/<slug>.config.json` の `gas.execUrl` を編集した追加PRを出すか、
   このツールで再生成して差し替える

---

## GitHub認証方式

### 採用方式：Fine-grained Personal Access Token（第一候補）

ブラウザから直接GitHub REST APIを呼び出す方式のため、この管理画面専用の
Fine-grained PATを発行して使用します。

**必要な権限（このリポジトリのみに限定して発行すること）**

| 権限 | レベル |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Metadata | Read-only（Fine-grained PATでは自動的に必須） |

これ以外の権限（Actions, Administration, Secrets等）は不要です。有効期限は
短め（例: 90日）に設定し、使い終わったらGitHub側で失効させることを推奨します。

### tokenの扱い

- 入力したtokenは **ブラウザのメモリ（JS変数）上にのみ** 保持します。
- `localStorage` / `sessionStorage` / Cookie など、どこにも永続化しません。
- ページを再読み込み・再訪問すると毎回入力し直す必要があります（意図的な仕様です）。
- token自体をURL・DOM・console・生成ファイル・エラーメッセージへ出力しません
  （`lib/github.js` のエラーハンドリングはGitHub APIのエラーメッセージのみを表示し、
  tokenを含む文字列を組み立てません）。
- token入力欄は `type="password"` かつ `autocomplete="off"` です。

### フォールバック：classic PAT（`repo`スコープ）

Fine-grained PATで branch作成・commit は成功するが、PR作成だけ
`403 Resource not accessible by personal access token` 等で失敗するリポジトリ設定に
遭遇した場合は、そのリポジトリ側の制約（Fine-grained PAT自体をorganizationが
許可していない等）が原因の可能性があります。その場合のみ、フォールバックとして
`repo` スコープのclassic PATを比較検討してください。ただし常に **必要最小限の
権限のtokenをその都度発行し、使い回さない** ことを前提とします。

### 既知の制約（未検証事項）

このツールのGitHub API呼び出し自体（`main`の最新SHA取得→branch作成→
`contents` API でのファイルcommit→PR作成）は、Issue #256のコメントで報告した
最小スパイクにより、このリポジトリに対して技術的に成立することを確認済みです
（そのスパイクはClaudeエージェントのセッションに付与された既存GitHub連携で実行した
ものであり、実際のブラウザ発行Fine-grained PATそのものではありません）。

**実際にブラウザから発行したFine-grained PATを使った送信〜PR作成までの
E2E確認は、本実装のセッションでは実施していません**（実PATの発行はこのセッションの
権限外の、運営者による手動操作のため）。初回利用時に運営者の手元で一度、
実際のPATを使って動作確認してください。403が出た場合は上記フォールバックを検討し、
その結果をIssue側にフィードバックしてください。

---

## 設定JSONスキーマ

生成される `<section>/<slug>.config.json` の形式です（`lib/validate.js` が実質的な
スキーマ定義です）。

```jsonc
{
  "schemaVersion": 1,
  "type": "event_entry",              // event_entry | date_survey | cross_tab_survey
  "section": "community",             // community | baseball
  "slug": "classroom_20260912",       // 英小文字・数字・_のみ。生成ファイル名の元
  "title": "9/12教室セット撮影会 参加申込",
  "subtitle": "...",                  // hero直下の説明文
  "description": "...",               // meta description / OGP説明文
  "ogImagePath": "images/community/xxx/meta-ogp-main.jpg", // 省略時は共通デフォルト画像

  "event": {                          // type=event_entryのときのみ使用
    "eventDate": "2026-09-12",
    "startTime": "13:00",
    "endTime": "16:00",
    "fee": "3,000円",
    "capacity": 10,
    "venue": "上前津スタジオ",
    "deadline": "2026-09-10T23:59:59+09:00",
    "entryStatus": "open"             // open | closed | waitlist
  },

  "dates": [                          // type=date_survey / cross_tab_surveyのときのみ使用
    { "key": "date_0905", "date": "2026-09-05", "label": "9/5（土）", "hosted": true }
    // hosted:false は「開催しない日」。非表示のまま常に未選択で送信される
  ],

  "questions": [
    {
      "key": "q1_first_choice",       // 英小文字始まり、英数字・_のみ。重複禁止
      "type": "radio",                // text | textarea | radio | checkbox | select
      "label": "第一希望企画",
      "required": true,
      "help": "",                     // 補足文（任意）
      "maxLength": 300,               // text / textareaのみ
      "options": [{ "label": "屋内スタジオ撮影会" }], // radio/checkbox/selectのみ、2件以上必須
      "allowOther": false             // radio/checkboxのみ。「その他」自由記述欄を追加
    }
  ],

  "contact": { "email": true, "x": true },
  "consent": { "enabled": true, "label": "注意事項に同意します" }, // 主にevent_entry用

  "analytics": {
    "formName": "classroom_20260912_form",
    "leadEvent": "generate_lead",     // survey_submit | generate_lead
    "leadType": "snbc_event_entry"    // leadEvent=generate_lead のときは固定値（README.md規約）
  },

  "gas": {
    "execUrl": "",                    // GAS Web Appの /exec URL（未定なら空文字）
    "deployedManually": false         // 運営者がGoogle側で手動デプロイ済みかのUI上のフラグ
  }
}
```

---

## 生成されるもの

1件のフォーム生成につき、以下の2ファイルのみを生成します（両方とも新規ファイル、
既存ファイルの上書きはしません）。

- `<section>/<slug>.html` … 公開用フォームページ
- `<section>/<slug>.config.json` … 上記スキーマの設定JSON（次回の「前回を複製」や
  将来のツール改修時の参照用に、公開ページと同じ場所へ置いています）

resultsページ（集計ダッシュボード）とGAS側コードの自動生成は、このMVPの対象外です
（下記「対象外・残課題」を参照）。

---

## `.nojekyll` / front matter対策

このリポジトリは `.nojekyll` を使用しており、`.github/workflows/static.yml` は
リポジトリ全体を静的ファイルとしてそのままGitHub Pagesへアップロードします
（Jekyllビルドは行いません）。そのため生成HTMLの先頭にYAML front matter
（`---`）が混入すると、ビルドエラーにはならず **画面に`---`という文字列が
そのまま表示される事故** になります。

対策:
- `lib/render.js` の `renderFormHtml()` は常に `<!DOCTYPE html>` から書き出す
  文字列テンプレートで、front matterを生成する経路が存在しません。
- 「6. プレビュー」画面で、生成HTMLの先頭が `<!DOCTYPE` から始まり `---` を
  含まないことを自動チェックし、OK/NGを表示します。
- GitHub Pagesへのデプロイ後は、実際に公開URLを開いて `---` が表示されていないこと、
  404やJS/CSSの読み込みエラー、コンソールエラーが無いことを目視確認してください。

---

## GA4計測（`analytics.js`）との整合

- 新しいイベント名は追加していません。使用するのは既存の
  `form_start` / `form_error` / `survey_submit` / `generate_lead` のみです。
- `generate_lead` を送るときの `lead_type` は、README.md（リポジトリルート）の
  規約どおり `snbc_event_entry` に固定しています
  （既存の `classroom_20260912.html` は `lead_type: 'classroom_20260912'` を
  送っており規約と食い違っていましたが、本ツールではその不整合を踏襲せず
  規約側に合わせています）。
- `?test=1` 相当（プレビュー画面、および生成ページの `?test=1`）・`?test=closed` 相当は、
  既存フォームと同じ思想でGAS送信・GA4送信を行いません。個人情報
  （氏名・年代・メール・Xアカウント・自由記述等）はGA4へ送信しません。

---

## 対象外・残課題（MVPで自動化していないこと）

- **新規Google Apps Scriptプロジェクトの作成／初回Web Appデプロイ／`/exec`URLの発行／
  Googleアカウント認可**：すべてGoogle側での手動作業です。このツールは発行済みURLを
  入力するだけです。「PRを作成」ボタンは **GitHub上に公開用PRを作成するところまで**
  を意味し、GASデプロイの完了を意味しません（「6. プレビュー」「5. 連絡先/GAS/計測」
  各画面にその旨の注意書きを表示しています）。
- **実PAT（Fine-grained PAT）を用いたブラウザ側E2E確認**：上記「GitHub認証方式」の
  既知の制約を参照。運営者の初回利用時に確認してください。
- **候補日UIは1パターンのみ**：既存フォームには「複数選択チェックボックス＋除外日hidden
  維持」と「日付ごとの独立ラジオ〇×」の2パターンが存在しますが、本ツールは前者のみを
  実装しています。後者（baseballの日付別締切・contact upsert等の高度なGAS連携）が
  必要な場合は別途拡張してください。
- **resultsページ（集計ダッシュボード）・GASバックエンドコードの自動生成**：対象外です。
  既存の `community/gas/` `baseball/gas/` を参考に、必要に応じて手動で用意してください。
- **既存公開フォームのmigration**：行っていません（別Issue扱い）。
