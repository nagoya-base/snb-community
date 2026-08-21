# フォームジェネレーター（内部ツール・MVP）

`nagoya-base/snb-community` のイベント応募フォーム・アンケートページを、
スマホから短時間で作成するための内部管理アプリです。GitHub Pagesのナビゲーションには掲載しません
（`noindex, nofollow, noarchive` を設定し、sitemap.xmlにも含めません）。

対象URL（マージ後）: `https://nagoya-base.github.io/snb-community/tools/form-builder/`

## できること（MVP）

1. テンプレート選択（イベント応募フォーム／開催日アンケート／企画・クロス集計アンケート）
2. 「前回を複製」プリセットからの読み込み（既存3フォームの簡略化された再現。DOM解析ではなく手作業で設定データ化したもの）
3. 基本情報・イベント情報・候補日・候補企画・連絡先項目・質問項目の入力
4. 入力内容の検証（slug形式、質問keyの重複、選択肢不足、候補日0件、既存ファイル衝突など）
5. プレビュー（本番の送信・通知・GA4計測は一切発生しません。常にテストモード扱いで生成されます）
6. `main`の最新SHA取得 → 作業ブランチ作成 → 生成HTML・設定JSONのcommit → Pull Request作成
   （**mainへの直接commitは行いません。auto-mergeもしません。**）

## できないこと（意図的にスコープ外）

- Google Apps Script（GAS）の新規プロジェクト作成・初回Web Appデプロイ・`/exec` URL発行
  → **運営者がGoogle側で手動で行ってください。** 本ツールは発行済みの`/exec` URLを入力・検証し、
    設定JSON・生成HTMLへ反映するところまでを担当します。
  → 参考実装: `community/gas/*.gs`、`baseball/gas/*.gs`。新しいフォームのGASは、これらに近い構成を
    手動で複製・調整してデプロイすることを想定しています（GASの自動生成・共通ライブラリ化は本MVPの対象外）。
- 集計結果（resultsページ）の自動生成
- PWA化

「PRを作成」ボタンは、**GitHub上に公開用PRを作成するところまで**を意味します。GASが未デプロイの間は、
生成されたHTMLの送信ボタンはプレースホルダーURLのままとなり、安全側に倒されて送信は失敗します
（誤って「PR作成 = 公開完了」と誤認しないよう、GAS未設定時は警告を表示します）。

## GitHub認証について（Fine-grained PAT）

このツールはブラウザから直接 GitHub REST API を呼び出します。サーバーやプロキシは介しません。

- **保存しません。** 入力したトークンはページのメモリ上（JS変数）にのみ保持し、
  `localStorage` / `sessionStorage` / Cookie 等への書き込みは一切行いません。
  ページを再読み込みすると破棄されます。「トークンを破棄」ボタンで明示的に破棄することもできます。
- コードにトークンをハードコードしていません。URL・DOM・コンソール・生成物・エラー表示にも
  トークンを含めない実装にしています（GitHub APIのエラーレスポンスに含まれる`message`のみを表示します）。

### 発行手順（Fine-grained PAT）

1. GitHubの Settings → Developer settings → Personal access tokens → **Fine-grained tokens** で新規発行
2. Repository access: **Only select repositories** → `nagoya-base/snb-community` のみを選択
3. Permissions（最小権限）:
   - **Contents: Read and write**（branch作成・ファイルcommitに必要）
   - **Pull requests: Read and write**（PR作成に必要）
4. 有効期限は短め（例: 7日）に設定し、作業が終わったら失効させることを推奨します。

### 既知の制約

Fine-grained PATは、リポジトリの設定によっては「branch作成・commitは成功するがPR作成のみ
`403 Resource not accessible by personal access token`で失敗する」ケースが報告されています。
この場合の対応:

1. まずPAT側の **Pull requests: Read and write** 権限が付与されているか再確認する
2. それでも解消しない場合のみ、フォールバックとして classic PAT（`repo`スコープ）の利用を検討する
   （ただし最初から広い権限を要求する設計にはしないこと）

本リポジトリに対しては、実装時のスパイク（`main`最新SHA取得→branch作成→1ファイルcommit→PR作成）で
一連の操作が技術的に成立することを確認済みです（Issue #256 のコメント参照）。ただし、そのスパイクは
セッションに付与された既存のGitHub連携で実行したものであり、実際にブラウザから発行するFine-grained PAT
そのものでの検証ではありません。実際の運用開始時に、実PATでの動作を必ず確認してください。

## `.nojekyll` / front matter について

このリポジトリは Jekyll ビルドを行わず、`.github/workflows/static.yml` がリポジトリ全体を
そのまま GitHub Pages にデプロイします。そのため生成HTMLの先頭に YAML front matter（`---`）が
混入すると、ビルドエラーにはならず**画面にそのまま`---`が文字表示される事故**になります
（`REVIEW_CHECKLIST.md` 観点2参照）。

`js/render.js` の `assertNoFrontMatter()` が生成のたびにHTML先頭を検証し、
`<!DOCTYPE html>` 以外で始まる場合は例外を投げて生成・PR作成を中断します。

マージ後は、GitHub Pagesの実URL（`https://nagoya-base.github.io/snb-community/tools/form-builder/`
および生成した各フォームの公開URL）をfetchし、404・front matter混入・コンソールエラーが
無いことを確認してください。

## データ形式

生成物:

- 公開用HTML: `{directory}/{slug}.html`
- 設定JSON: `{directory}/formdata/{slug}.config.json`（configスキーマをそのまま保存。将来「前回を複製」の
  読み込み元として再利用できるよう、公開HTMLと同時にコミットしています）

## 既存実装との差分・簡略化した点

- 各フォームの「連絡先項目」「質問項目」は共通テンプレート＋設定データとして再構成しており、
  既存の`classroom_20260912.html`等が持つ全項目（衣装オプションの詳細な選択肢文言など）を
  1対1で再現するものではありません。テンプレート選択後、質問項目欄で追加・調整してください。
- GASコードは自動生成しません（前述）。
- スタイルは各生成HTML内に埋め込み（`<style>`）＋共通`../common.css`参照とし、
  ページごとの`style.css`は生成しません（生成ファイル数を最小限にするため）。
- 候補日のフィールド名は `date_YYYYMMDD`（例: `date_20260905`）としています。既存の一部フォームは
  `date_MMDD`（例: `date_0905`）形式ですが、年をまたぐ運用での衝突を避けるため本ツールでは年を含めています。
  既存GASと連携する場合は列名の対応に注意してください。
