# フォームジェネレーター（運営用）

`nagoya-base/snb-community` のイベント応募フォーム・アンケートを、共通テンプレート＋設定データから生成し、GitHub上にPull Requestとして反映するための運営内部ツールです。

このページは公開サイトの通常ナビゲーションには掲載していません。URLを知っている運営者のみが利用する想定です（`robots: noindex, nofollow, noarchive`）。

## できること

1. テンプレート（イベント応募フォーム／開催日アンケート／企画・クロス集計アンケート）を選ぶ、または現行の代表フォームを雛形として読み込む
2. タイトル・日付・料金・候補日・質問項目などをスマホ画面から編集する
3. 実際に生成されるページをプレビューする（`?test=1`相当。GAS送信・GA4送信は一切行われません）
4. 「PRを作成」で、GitHub上に専用branch・生成ファイル・Pull Requestを作成する

**mainへの直接commitは行いません。** 生成されたPRは、必ず人間が内容を確認してからmergeしてください。

## できないこと（範囲外）

- Google Apps Script の新規プロジェクト作成・初回デプロイ・`/exec` URL発行
  - これらはGoogle側の操作のため、運営者が手動で行います。発行済みの `/exec` URLをこのツールに入力するところまでが対象です。
  - GAS未設定のまま生成したフォームは、送信ボタンを押しても「現在、この申込フォームは準備中のため送信できません」と表示され、実際には何も送信されません（`form-runtime.js` 内のプレースホルダー安全策）。
  - **「PRを作成」＝GitHub上に公開用PRを作成するところまでです。GASの手動デプロイ完了を意味しません。**
- 既存フォーム（`community/enquete_202609.html` 等）の一括migration
- PWA化・オフライン対応

## アーキテクチャ

「共通テンプレート＋設定データ」を徹底し、フォームごとの巨大な個別スクリプトを複製しない構成にしています。

- `tools/form-builder/` … このツール本体（管理画面）。ビルド不要のES Modules。
  - `index.html` / `style.css` / `app.js` … 画面本体（テンプレート選択→入力→プレビュー→PR作成）
  - `schema.js` … 設定データのスキーマ・デフォルト値・公開前バリデーション
  - `generator.js` … 設定データから公開用HTML／設定JSONを生成
  - `github.js` … ブラウザから直接GitHub REST APIを呼ぶ最小クライアント
  - `presets.js` … 「前回を複製」用のプリセット（現行代表フォームを参考に再構成したJSON）
- `form-runtime.js` / `form-runtime.css`（リポジトリ直下、`analytics.js`と同じ配置） … 生成されたすべての公開ページが共通で読み込むランタイム。フォーム項目の描画・入力検証・確認画面・GAS送信・GA4計測を担う。
- 生成される公開ページ（例 `community/enquete_202610.html`）は、`<head>`（meta/OGP/canonical/テストモード/GA4/analytics.js）と、埋め込み設定JSON（`<script type="application/json" id="snb-form-config">`）のみを持つ薄いファイルになります。フォームの見た目・挙動は `form-runtime.js` が設定JSONを解釈して描画します。
- 生成される設定JSONは `{pillar}/form-data/{slug}.json` に保存されます（例 `community/form-data/enquete_202610.json`）。

### `.nojekyll` / front matter対策

このリポジトリは `.nojekyll` 構成で、`.github/workflows/static.yml` は静的ファイルをそのままGitHub Pagesへデプロイします（Jekyllビルドは行いません）。生成HTMLの先頭に `---` のようなfront matterが混入すると、ビルドされずにそのまま画面表示される事故になります。

`generator.js` の `generateHtml()` は、生成結果の先頭が `<!DOCTYPE html>` で始まることを内部でチェックし、`---` から始まる場合は例外を投げて生成を止めます。また生成HTMLはテンプレート文字列で組み立てており、front matter相当の区切り記法は使用していません。

## GitHub認証について

ブラウザから直接 GitHub REST API を呼び出します。**サーバーやバックエンド関数は使いません。**

### 採用方式：Fine-grained Personal Access Token

- 第一候補として、リポジトリ単位で権限を絞れる **Fine-grained PAT** を使用します。
- 必要な権限（このリポジトリ `nagoya-base/snb-community` に対して）：
  - **Contents: Read and write**（branch作成・ファイルcommit用）
  - **Pull requests: Read and write**（PR作成用）
- それ以外の権限は付与しないでください。

### トークンの扱い

- トークンは `tools/form-builder/github.js` 内のメモリ変数（`_token`）にのみ保持します。
- **localStorage / sessionStorage には一切保存しません。** ページを再読み込みするとトークンは消え、再入力が必要です。
- URL・DOM・console・生成ファイル・エラーメッセージにトークンを出力しないよう実装しています（`github.js` のエラーメッセージは定型文＋HTTPステータスのみ）。
- トークンの発行・失効は [GitHub Settings → Developer settings → Fine-grained tokens](https://github.com/settings/tokens?type=beta) から行ってください。作業が終わったら失効させることを推奨します。

### GitHub APIスパイク結果

本体実装前に、「main最新SHA取得 → テスト用branch作成 → ダミー1ファイルcommit → PR作成」の一連が技術的に成立することを確認済みです（Issue #256のコメント参照、テストPR #257は確認後クローズ）。このスパイクはClaudeエージェントセッションの既存GitHub連携で実施したもので、実際のFine-grained PATでのブラウザ側E2E確認は、運営者が初回利用時に行ってください。万一Fine-grained PATでPR作成のみ `403 Resource not accessible by personal access token` 等になる場合は、フォールバックとして `repo` スコープのclassic PATを比較検討してください（最初から広い権限を要求する設計にはしていません）。

## 使い方

1. `tools/form-builder/index.html` を開く（GitHub Pagesデプロイ後の実URL、または手元でstaticサーバーを立てて確認）
2. 「1. テンプレート」でフォーム種別を選ぶ、または「前回を複製」からプリセットを読み込む
3. 「2. 入力」で基本情報・候補日・質問項目などを編集する
4. 「3. プレビュー」で表示・操作を確認する（390px/デスクトップ幅切り替えあり）
5. 「4. PR作成」でGitHub認証情報を入力し、「PRを作成」を押す
6. 表示されたPR URLを開き、内容を確認してmergeする（人間の作業）
7. GASの `/exec` URLが未設定だった場合は、Google Apps Script側の手動デプロイ後、設定JSON・生成HTML内のプレースホルダーを更新するPRを別途作成する

## セキュリティ上の配慮

- 生成HTML・管理画面はいずれもDOM構築を `createElement` / `textContent` で行い、利用者入力を `innerHTML` へ直接流し込みません（XSS対策）。
- 設定JSONを `<script type="application/json">` へ埋め込む際、`<` を `<` にエスケープし、`</script>` によるタグ早期終了を防いでいます。
- フォーム送信にはスパム対策のハニーポット入力（`name="website"`）を含めています（既存フォームと同じ方式）。
- 個人情報（氏名・連絡先・自由記述等）はGA4へ一切送信しません（`analytics.js` の既存規約を継承）。

## 既知の制約・残課題

- 質問タイプは text / textarea / radio / checkbox / select / 候補日・候補企画からの自動選択肢（date_single, date_multi, plan_single）に限定しています。既存フォームにある「衣装の有無で分岐」のような複雑な条件分岐や、キャリアメール受信設定の案内のような個別UIは未対応です。
- 結果集計ページ（`*_results.html` 相当、GAS集計APIをポーリングして表示）はMVP範囲外です。
- GASバックエンド（スプレッドシート書き込み・重複防止・通知メール）の自動生成は行いません。既存の `community/gas/` `baseball/gas/` を参考に、運営者が手動で用意・接続してください（本ツールが生成するpayloadのキーは、質問のkeyをそのまま使うフラットな形式です。既存GASの `q1_`/`q2_` 命名とは異なるため、新規GASを用意する際はこのキー形式に合わせてください）。
- 生成後のOGP画像は自動生成しません。`IMAGE_NAMING_RULES.md` の命名規則に沿ったファイルを別途手動で配置してください。
