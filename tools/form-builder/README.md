# form-builder（フォームジェネレーター）

SNBコミュニティの応募フォーム・アンケートを、スマホから雛形選択→入力→プレビュー→PR作成まで完結させる運営内部ツールです。公開サイトの通常ナビゲーションには掲載されません。

対応Issue: [#256](https://github.com/nagoya-base/snb-community/issues/256)

## できること／できないこと

**できること**
- 3種類のテンプレート（イベント応募フォーム／開催日アンケート／企画・クロス集計アンケート）から選んで入力
- 「前回を複製」で現行の代表フォームに近い雛形を読み込み
- 390px（iPhone Safari相当）〜1440px（PC）でのプレビュー（**送信操作をしてもGAS保存・メール通知・GA4送信は一切発生しません**）
- 入力内容から公開用HTML＋設定JSONを生成し、GitHub上にブランチ作成→コミット→Pull Request作成まで自動化

**できないこと（対象外・手動作業が必要）**
- 新しいGoogle Apps Scriptプロジェクトの作成・Google側での初回Web Appデプロイ・新しい `/exec` URLの発行・Googleアカウント認可
  → これらは運営者がGoogle側で事前に手動実施し、発行済みの `/exec` URL を「GAS Web App連携」欄に入力してください
- 集計・resultsページ（`*_results.html` 相当）の自動生成
- 既存フォームで実装されているbaseball方式の連絡先upsert（同一人物の再回答による行更新）
- **「PRを作成」＝GitHub上に公開用PRが作成されるところまでを意味します。GASの手動デプロイが未完了の場合、そのPRはマージしてもフォーム送信が機能しません。** マージ前にGAS側の準備状況を必ず確認してください。

## 使い方

1. `tools/form-builder/index.html` をブラウザで開く（ローカルでの動作確認は `python3 -m http.server` 等の静的サーバーで可）
2. テンプレートを選択、または「前回を複製」から雛形を読み込む
3. タイトル・slug・公開先ディレクトリ・候補日・質問項目・GAS `/exec` URL などを入力
4. プレビューで表示・入力操作を確認（390px / 1440px 切り替え可能）
5. 「PR作成」画面でGitHubトークンを入力し、「PRを作成」を押す
6. 作成されたPRのURLが表示されるので、内容を確認して人間がmergeする（**main直接commit・auto-mergeはしない**）

## GitHub認証について

### 採用方式：Fine-grained Personal Access Token（第一候補）

ブラウザから直接GitHub REST APIを呼び出すため、GitHubの個人アクセストークンをこの画面で入力します。

- トークンは **画面のJS変数上でのみ保持し、localStorage/sessionStorageには一切保存しません**。ページを閉じる・再読み込みすると消えます
- URL・DOM属性・コンソール・生成ファイル・エラーメッセージにトークンを出力しません
- PR作成成功時、入力欄のトークンは自動でクリアされます

### 必要な権限（Repository permissions）

作成する Fine-grained PAT には、対象リポジトリ `nagoya-base/snb-community` に対して最低限以下を付与してください。

| 権限 | レベル |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Metadata | Read-only（Fine-grained PATでは自動付与） |

### Fine-grained PATスパイク結果

Issue #256 のレビュー指示に基づき、本体実装前にGitHub API（`main`最新SHA取得→branch作成→1ファイルcommit→PR作成）の最小スパイクを実施しました。このリポジトリの設定（ブランチ保護なし）では一連の操作がAPIレベルで問題なく成立することを確認済みです（詳細はIssue #256のコメント参照）。

ただし、そのスパイクは本セッションに付与されたGitHub App由来のトークンで実行したものであり、**実際にブラウザから発行するFine-grained PATでの動作確認は別途必要**です。特にPR作成でFine-grained PAT特有の `403 Resource not accessible by personal access token` が発生するかどうかは、実運用時に確認してください。

### フォールバック：classic PAT

Fine-grained PATで `Pull requests: Read and write` を付与してもPR作成のみ403になる場合は、フォールバックとして classic PAT（`repo` スコープ）の利用を検討してください。ただし `repo` スコープは対象リポジトリ以外にもアクセス可能な広い権限のため、最初から classic PAT を既定にはしていません。

## 設定JSONスキーマ

`tools/form-builder/templates/schema.js` のコメントを参照してください。生成されるフォームページは `assets/form-runtime/forms.js` が設定JSONを読み込んで描画する共通ランタイム方式です（フォームごとにHTML/CSS/JSを個別に書きません）。

## 生成されるファイル

- `{pageDir}/{slug}.html` … 公開用フォームページ（`assets/form-runtime/forms.js` / `forms.css` / `../analytics.js` を参照する薄いシェル）
- `{pageDir}/{slug}.form.json` … 設定JSON（生成の元データ。将来の再編集・再生成にも利用可能）

## `.nojekyll` / front matter対策

このリポジトリは `.nojekyll` を使用し、Jekyllビルドを行わずファイルをそのままGitHub Pagesへ配置します。生成HTMLの先頭にYAML front matter（`---`）が混入すると、`.nojekyll`環境ではそれがそのまま画面にテキスト表示されてしまいます。

- `templates/renderer.js` は常に `<!DOCTYPE html>` から始まるHTML文字列を生成します
- `validate.js` の `checkFrontMatter()` が、プレビュー表示時・PR作成直前の両方で生成HTMLの先頭を検証し、`---` 混入や `<!DOCTYPE html>` 以外の先頭を検出した場合はPR作成をブロックします

## テストモード

生成されたフォームページは既存フォームと同じ `?test=1`（送信・通知・GA4を発生させずに画面確認）/ `?test=closed`（受付終了表示の確認）をサポートします。form-builder自体のプレビュー画面（iframe内表示）は、クエリの有無に関わらず常にテストモード扱いになります（`window.FF_FORCE_PREVIEW_TEST_MODE = true` を強制注入）。

## analytics.js（GA4）との整合

- `generate_lead`（`lead_type` はテンプレート・入力内容に応じて設定、既定は `snbc_event_entry`）… イベント応募フォームの送信成功時のみ
- `survey_submit` … 開催日アンケート／企画・クロス集計アンケートの送信成功時
- どちらもテストモード・プレビューでは発火しません
- 独自のイベント名は追加していません（`README.md`（リポジトリルート）記載の「使用してよいイベント名」の範囲内）

## 動作確認状況

- 390px（iPhone Safari相当）／1440px（PC）でのテンプレート切替・候補日追加削除・質問項目編集・バリデーション・プレビュー・送信フロー（テストモード）を Chromium（Playwright）で確認済み
- プレビュー・テストモードでの送信操作時、GAS宛のネットワークリクエストが一切発生しないことを確認済み
- 生成HTMLの先頭 front matter 非混入、`<!DOCTYPE html>` 開始を確認済み
- 生成HTMLへの入力値（タイトル・質問ラベル等）がエスケープされ、`<script>`タグ等を注入できないことを確認済み
- GitHub API連携（branch作成→commit→PR作成）はリクエスト形状（URL・メソッド・認証ヘッダー・ボディ）を検証済み。**実際のFine-grained PATを使ったブラウザ操作でのE2E確認は運用開始時に別途実施してください**
- GitHub Pagesへのデプロイ後、実URLでの表示確認はPRマージ後に実施が必要です（本ツールの実装時点では未デプロイ）
