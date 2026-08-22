# form-builder（フォームジェネレーター）

SNBコミュニティの応募フォーム・アンケートを、スマホから雛形選択→入力→プレビュー→PR作成まで完結させる運営内部ツールです。公開サイトの通常ナビゲーションには掲載されません。

対応Issue: [#256](https://github.com/nagoya-base/snb-community/issues/256) / [#266](https://github.com/nagoya-base/snb-community/issues/266)（通知メール全項目対応・GASテンプレート生成）

## できること／できないこと

**できること**
- 3種類のテンプレート（イベント応募フォーム／開催日アンケート／企画・クロス集計アンケート）から選んで入力
- 「前回を複製」で現行の代表フォームに近い雛形を読み込み（野球ユニ部プリセットは[Issue #263](https://github.com/nagoya-base/snb-community/issues/263)の24項目通知に対応した質問構成を初期値で持つ）
- 390px（iPhone Safari相当）〜1440px（PC）でのプレビュー（**送信操作をしてもGAS保存・メール通知・GA4送信は一切発生しません**）
- 通知メール設定（ON/OFF・件名・通知対象項目と日本語ラベル）を入力・確認。既定では、そのフォームが保存する全項目が通知メールに含まれる（未回答も省略しない）
- 入力内容から公開用HTML＋設定JSON＋GASバックエンドテンプレートを生成し、GitHub上にブランチ作成→コミット→Pull Request作成まで自動化

**できないこと（対象外・手動作業が必要）**
- 新しいGoogle Apps Scriptプロジェクトの作成・Google側での初回Web Appデプロイ・新しい `/exec` URLの発行・Googleアカウント認可
  → これらは運営者が、生成された `{pageDir}/gas/{slug}_backend.gs` の内容をGoogle側で手動反映（新規プロジェクト作成→貼り付け→デプロイ）し、発行済みの `/exec` URL を「GAS Web App連携」欄に入力してください
- 集計・resultsページ（`*_results.html` 相当）の自動生成
- 既存フォームで実装されているbaseball方式の連絡先upsert（同一人物の再回答による行更新）。生成されるGASテンプレートは `submission_id` による冪等性のみを持ち、再回答は新しい行として追記される
- **「PRを作成」＝GitHub上に公開用PRが作成されるところまでを意味します。GASの手動デプロイが未完了の場合、そのPRはマージしてもフォーム送信が機能しません。** マージ前にGAS側の準備状況を必ず確認してください。

## 使い方

1. `tools/form-builder/index.html` をブラウザで開く（ローカルでの動作確認は `python3 -m http.server` 等の静的サーバーで可）
2. テンプレートを選択、または「前回を複製」から雛形を読み込む
3. タイトル・slug・公開先ディレクトリ・候補日・質問項目・通知メール設定・GAS `/exec` URL などを入力
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

### Fine-grained PATスパイク結果／実PAT E2E確認

Issue #256 のレビュー指示に基づき、本体実装前にGitHub API（`main`最新SHA取得→branch作成→1ファイルcommit→PR作成）の最小スパイクを実施しました（詳細はIssue #256のコメント参照）。このスパイクは本セッションに付与されたGitHub App由来のトークンで実行したものでした。

その後、運営者により**実際にブラウザから発行したFine-grained PATを使ったE2E確認**が完了しています（PR #262、`Contents: Read and write` / `Pull requests: Read and write` 権限）。main最新SHA取得→branch作成→HTML commit→設定JSON commit→PR作成まで403等のエラーなく成功し、テストPR・使用トークンともにクローズ／Revoke済みです。テストブランチ（ダミーファイルのみ）は削除機能未実装のため残存しています。

### フォールバック：classic PAT

Fine-grained PATで `Pull requests: Read and write` を付与してもPR作成のみ403になる場合は、フォールバックとして classic PAT（`repo` スコープ）の利用を検討してください。ただし `repo` スコープは対象リポジトリ以外にもアクセス可能な広い権限のため、最初から classic PAT を既定にはしていません。

## 設定JSONスキーマ

`tools/form-builder/templates/schema.js` のコメントを参照してください。生成されるフォームページは `assets/form-runtime/forms.js` が設定JSONを読み込んで描画する共通ランタイム方式です（フォームごとにHTML/CSS/JSを個別に書きません）。

## 通知メール（Issue #266）

生成されるGASテンプレートは、フォームが保存する全項目（連絡先・候補日・質問。無効化した質問は含まない）を通知メール本文へ日本語ラベル付きで掲載する。未回答の項目も「（未入力）」として省略しない。項目一覧は `config.notification.fields`（`tools/form-builder/templates/schema.js` の `buildFieldSpecs()` / `syncNotificationFields()` が導出）に保持され、「入力」画面の「通知メール」セクションでON/OFF・件名・各項目のラベルを確認・編集できる。「保存項目をすべて通知する」を外すと、項目ごとに通知対象を選べる（保存自体は常に全項目行われる）。

野球ユニ部プリセット（「9月キャッチボール会アンケートを雛形にする」）は、[Issue #263](https://github.com/nagoya-base/snb-community/issues/263)で `baseball/gas/enquete_202609_backend.gs` に定義された24項目（`submission_id` 〜 `x_contact_method`）と同じキー構成・日本語ラベルを初期値として持つ。ただし baseball方式固有の「同一人物1票・連絡先upsert」照合ロジックは対象外（下記「できないこと」参照）。

## GASバックエンドテンプレート（Issue #266）

生成先は `{pageDir}/gas/{slug}_backend.gs`。`tools/form-builder/templates/gas-renderer.js` が設定JSONから生成する。含まれる内容：

- `doPost` / Sheetへの保存（列構成は保存対象の全項目から自動生成）
- `submission_id` による冪等性（同じIDの再送は行を増やさず、通知もしない）
- 保存値確定後の値を使った通知メール本文組み立て（`buildNotificationBody_`）・`MailApp.sendEmail()`
- POST先URLへの `?test=1` 相当（`test_responses` シートへ書き込み、通知メールは送らない）
- メール送信失敗を回答保存の失敗として扱わない
- Formula Injection対策・サーバー側allowlist（選択肢系項目）による簡易バリデーション

「入力」画面の「GAS Web App連携」セクションから、PR作成前でもテンプレート内容をプレビュー・コピーできる（`/exec` URLがまだ無い状態でも、先にこの内容をGoogle Apps Scriptへ貼り付けて手動デプロイし、発行されたURLを入力してからPRを作成する運用を想定）。PR作成時は、その時点の設定内容から改めて同じ内容が生成されコミットされる。

このテンプレートを生成・コミットするだけではGoogle Apps Script側は一切変更されない（新規プロジェクト作成・認可・初回Web Appデプロイ・`/exec` URL発行は引き続き手動）。

## 生成されるファイル

- `{pageDir}/{slug}.html` … 公開用フォームページ（`assets/form-runtime/forms.js` / `forms.css` / `../analytics.js` を参照する薄いシェル）
- `{pageDir}/{slug}.form.json` … 設定JSON（生成の元データ。通知メール設定を含む。将来の再編集・再生成にも利用可能）
- `{pageDir}/gas/{slug}_backend.gs` … GASバックエンドテンプレート（上記「GASバックエンドテンプレート」参照。運営者による手動デプロイが別途必要）

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

- 390px（iPhone Safari相当）／1440px（PC）でのテンプレート切替・候補日追加削除・質問項目編集・バリデーション・プレビュー・送信フロー（`?test=1` / `?test=closed` 双方）を Chromium（Playwright）で確認済み
- プレビュー・テストモードでの送信操作時、GAS宛のネットワークリクエストが一切発生しないことを確認済み（`?test=closed`は確認画面到達後の送信操作を含めて確認。無指定＝本番想定では実際に送信リクエストが発生することも確認し、過剰ブロックでないことも確認済み）
- 無効化（OFF）した質問が公開ページの描画・検証・送信payloadに含まれないことを確認済み
- 候補日の曜日自動計算がタイムゾーンに依存しないことを確認済み
- 生成HTMLの先頭 front matter 非混入、`<!DOCTYPE html>` 開始を確認済み
- 生成HTMLへの入力値（タイトル・質問ラベル・JSON-LD等）がエスケープされ、`<script>`タグ等を注入できないことを確認済み
- GitHub API連携（branch作成→commit→PR作成）はリクエスト形状（URL・メソッド・認証ヘッダー・ボディ）を検証済み。**実際のFine-grained PATを使ったブラウザ操作でのE2E確認も運営者により完了済み**（PR #262、詳細は上記「Fine-grained PATスパイク結果／実PAT E2E確認」参照）
- （Issue #266）野球ユニ部プリセットで通知対象項目が24件（`submission_id`〜`x_contact_method`、Issue #263と同じキー）揃うこと、質問をOFFにすると通知対象からも消えること（24→23件）、「保存項目をすべて通知する」を外すと項目ごとの通知ON/OFFが選べること、390px幅で横スクロールが発生しないことを Chromium（Playwright）で確認済み
- （Issue #266）生成されるGASテンプレートの構文（`node --check`）、および doPost の主要経路（新規保存・重複submission_idの抑止・バリデーションエラー・`?test=1`でのtest_responsesへの書き込みと通知抑止・通知メール本文の内容）をNode.jsのモックGAS環境で確認済み。実際のGoogle Apps Script環境への貼り付け・デプロイでの動作確認は運営者による手動作業が必要です
- GitHub Pagesへのデプロイ後、実URLでの表示確認はPRマージ後に実施が必要です（本ツールの実装時点では未デプロイ）
