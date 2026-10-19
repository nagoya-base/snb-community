# 名古屋野球ユニ部アンケート（design v2.17）

親Issue #377 / 本ディレクトリの範囲は Issue #378（schema 正本の配置・参照整合 validation・CI）、Issue #379（専用 survey-core の fork と v2.17 構文対応）、Issue #380（Public GAS・保存・匿名重複抑止・server validation・test mode・受付期間・通知・deploy workflow）です。
Frontend・Admin・公開結果ページ・maintenance/finalize は後続Issue（#381〜）で追加します。

## 正本

| ファイル | 役割 |
|---|---|
| `survey.schema.json` | design v2.17。設問・option・分岐・publication・semantic code の**唯一の正本** |

- `design_version = 2.17` / `survey_id = nagoya_baseball_uniform_club_2026` / `survey_version = 2026-10`
- 設問・option・分岐条件を各コードへベタ書きせず、必ずこの schema を参照します。
- 長期離脱の判定は文章で再定義せず、`conditions.lapsed_attendee` を唯一の正本とします。
- 公開設定は各 question の `publication` object のみを正本とします。
- `testModes.activation`: `preview_no_submit` / `closed_view` は回答を server へ送らない client-only preview（submit 用 test token 検証は不要）。`submit_excluded` のみ server へ送信し、server が test token を検証して mode を確定します。
- `respondentNotice.retention.status` は `must_set_before_launch` のままです。保持期限は未確定で、本番公開前に Owner（nagoya-base）が確定します（launch blocker）。

既存の `community/gas/costume_portrait_survey/` の schema / core / tests は変更しません。
Public GAS 用の生成物 `public/SurveyGenerated.gs` は schema + `survey.config.json` + `src/survey-core.js` から生成します（直接編集しません。後述）。

## 専用 survey-core（Issue #379）

`src/survey-core.js` は、v2.17 の schema を Frontend / Public GAS / Admin が**同じ意味で**解釈するための、副作用のない共通エンジンです。

### 専用 fork にした理由

- 既存の `community/gas/costume_portrait_survey/src/survey-core.js` は運用中の調査が使っており、`single / multi / matrix` と `includes / in` だけの旧構文を前提にしています。v2.17 の `all / any / conditionRef / hasAnyExcept`、`single_dynamic`、`scale + notApplicable` を共通 core に足すと運用中調査へ影響するため、**共通 core は直接拡張せず**、コピーして独立させました。
- **`community/gas/costume_portrait_survey/` 配下（core / schema / tests / 生成物）は変更しません。** 共通化は本 survey が安定してから別 Issue で検討します。
- `survey.schema.json` を core に合わせて変更することもしません（core が schema に合わせます）。
- 旧 core から、旧 test 状態値、無区切りの hash 連結式、旧 validation 定数は持ち込んでいません（core は hash・時間検証・保存を持ちません）。

### 対応範囲

| 区分 | 内容 |
|---|---|
| question type | `single` / `multiple` / `single_dynamic` / `scale` / `text`。旧 `multi / matrix` は新 survey の正本表現ではないため解釈せず、未知 type として扱う（検証は `unknown_question_type`） |
| condition | `conditionRef` / `all` / `any` / `question + equals` / `notEquals` / `in` / `contains` / `notContains` / `hasAnyExcept` |
| dynamic | `single_dynamic.sourceQuestion` で選択済みの stable option ID だけを source の option 順に候補化し、`excludeOptionIds` を除外。`other` は ID「other」として候補化し、自由記述本文は ID にしない |
| scale | `min..max`、`anchors`、`notApplicable`（尺度外の独立値）。回答の正規形は文字列 ID（`"1"`〜`"5"` / `notApplicable.id`）。数値回答も受理して文字列へ揃える |
| publication | `question.publication` を唯一の正本として参照（別の公開設定一覧は作らない） |

condition の評価規則:

- 不正・未知（未知の演算子 / 設問 / `conditionRef`、循環、空の `all / any`、演算子の重複、型違いの演算子）は **false（fail-safe）**。
- 未回答・非表示の設問に対する条件は、`notEquals / notContains` を含め **false**。
- 親設問が非表示のとき、その設問に残っている旧値は子の条件から**未回答として見える**（親条件が false になった後の stale 値が子の表示に漏れない）。

### core API

すべて schema と answers を引数に取り、どちらも書き換えません（時刻・乱数・storage・network に触れません）。

| 用途 | API |
|---|---|
| condition | `evalCondition(schema, condition, answers)` / `evalNamedCondition(schema, name, answers)` |
| 可視性 | `isVisible` / `visibleQuestionIds` / `visibleQuestions` / `requiredQuestionIds`（visible かつ `required:true` のみ） |
| dynamic | `getDynamicOptions` / `getEffectiveOptions` / `autoSelectValue`（`autoSelectIfSingle`） |
| multiple | `applyMultipleSelection`（exclusive の排他制御）/ `otherTextInfo`（「その他」本文の要否・上限） |
| scale / ordinal | `getScale`（points / notApplicable / orderedIds / allIds）/ `ordinalOrder`（`orderedIds` と、尺度外の `independentIds`） |
| publication | `getPublication` / `isPublic` / `publicQuestionIds` / `denominatorOf` / `countQuestionReached` |
| stale 値 | `findStaleValues`（`hidden` / `option_unavailable` / `other_text_stale`）/ `sanitizeAnswers`（変化がなくなるまで除去。Frontend の送信前処理用で、server では使わない） |
| 検証 | `validateAnswers(schema, answers, otherTexts)`（required は visible のみ、hidden の値は `hidden_field`）/ `findTermination` |
| test mode | `getTestMode` / `isProductionResponseMode` |

`denominator: question_reached` を正とし、Public payload の `targetCount` は `countQuestionReached`（その設問に実際に到達した有効回答者数）と**同じ概念**です。別概念としては実装しません。

test mode の正本は `response_mode + test_run_id` です。`preview_no_submit` / `closed_view` は client-only、`submit_excluded` のみ serverVerified で `response_mode = 'test'` として保存されます。core は mode の分類だけを返し、token の検証・保存は行いません。`response_mode` が欠損・未知値の場合は本番扱いにしません（fail-closed）。

### #380 / #381 での再利用前提

- 本ファイルは `module.exports`（Node.js）とグローバル `SurveyCore`（ブラウザ・Apps Script）の両方で使える ES5 です。schema は引数で受け取るため、Public GAS / Frontend / Admin へ**同一内容で配布**する生成・build は #380 以降で追加します（本 Issue では行いません）。
- 責務分離（`sanitizeAnswers` は Frontend 専用、server は受信 payload をそのまま検証）:
  - **Frontend**: 送信前に `sanitizeAnswers` を通し、hidden になった設問の旧値・候補外になった dynamic の旧値・不要な other 本文を除去してから送る。
  - **Server / Public GAS**: 受信 payload に `sanitizeAnswers` を通さず、**まず受信したままを `validateAnswers`** に渡す。hidden / unknown / stale（`hidden_field` / `unknown_field` / `invalid_option` / `other_text_unexpected` 等）は黙って消さず**拒否**する。sanitize で先に消すと、本来拒否すべき不正 payload を受理してしまう。
  - **保存**: 検証に通った `validateAnswers(...).clean` だけを保存する（受信 payload や sanitize 結果を直接保存しない）。
- #379 の範囲外だったもの: respondent hash の canonical serialization、最短回答時間の server 検証、test token の検証、保存、Public GAS endpoint、Spreadsheet、deploy は #380 で追加済み（下記）。Frontend UI（test token の URL fragment → sessionStorage → POST body を含む）は #381、Admin・public snapshot は #382、maintenance/finalize は #383。

## Public GAS（Issue #380）

`public/` が Public Web App（Apps Script）です。既存の `costume_portrait_survey` / 旧野球ユニ部アンケートの GAS・Spreadsheet とは独立で、**新規 Spreadsheet を前提**にします。

| ファイル | 役割 |
|---|---|
| `survey.config.json` | 受付期間（`opens_at` / `closes_at` / `timezone`）・最短回答時間・payload 上限・`test_run_id` 形式・通知の有効/無効の**正本**（Script Properties ではない） |
| `public/SurveyGenerated.gs` | **生成物（直接編集禁止）**。`SURVEY_SCHEMA` + `SURVEY_CONFIG` + 専用 core |
| `public/Config.gs` `Validation.gs` `Submission.gs` `Respondent.gs` `SheetStore.gs` `Notify.gs` `Setup.gs` `Main.gs` `Log.gs` | 受付判定 / envelope 検証 / 保存フロー / hash / Sheet 保存 / 通知 / 初期設定 / endpoint |

```bash
cd baseball/gas/baseball_uniform_survey
npm run build         # public/SurveyGenerated.gs を再生成
npm run build:check   # 生成物と正本の差分検出（npm test にも含まれ、CI で実行）
```

設問・option・分岐条件は GAS 側にベタ書きしません。schema と core を参照します。

### リクエスト（POST, `Content-Type: text/plain`, body = JSON）

| key | 内容 |
|---|---|
| `schema_version` | schema と一致しない場合は `schema_mismatch` |
| `uuid` | browser UUID（保存しない。hash の入力にのみ使う） |
| `answers` / `other_texts` | 受信したまま**最初に** `SurveyCore.validateAnswers` へ渡す（sanitize しない） |
| `elapsed_ms` | クライアント計測の経過時間 |
| `source_channel` | 任意。allowlist 以外・未指定は `unknown` |
| `test_token` / `test_run_id` | `submit_excluded` のときだけ。POST body で送り、query string には置かない |

上記以外の key（`response_mode` を含む）は `unknown_field` で拒否します。**mode は server が確定**します（token なし → `production`、token が正しい → `submit_excluded` = `response_mode=test`）。

応答: `{ok:true,status:'accepted'}` / `{ok:true,status:'accepted_test'}` / `{ok:true,status:'ineligible'}` / `{ok:false,error:...}`（`invalid_request` / `schema_mismatch` / `duplicate_submission` / `survey_not_open` / `survey_closed` / `survey_not_configured` / `server_error`）。`GET ?action=status` は受付状態（`open` / `not_open` / `closed` / `not_configured`）と version だけを返します。

### server-side validation

- 受信 payload は sanitize せず `validateAnswers` を最初に通します。hidden / unknown / stale / invalid option は**黙って除去せず拒否**します。保存する回答値は `validateAnswers(...).clean` のみです（受信 payload や sanitize 結果は保存しません）。
- required は visible のみ、multiple の exclusive、`other` 本文の要否・長さ、`single_dynamic` の source 整合、scale / `notApplicable` は core の判定に従います。
- **18歳未満**（`age_confirmed` の termination）は回答本文・hash・メタ情報を**一切保存せず**、valid count / 母数 / Admin 通常集計 / respondent meta count のいずれにも含めません（技術ログにはイベント名 `ineligible` だけ）。
- **最短回答時間**は production のみ検査し、閾値は `survey.config.json` の `validation.minElapsedMs`（現在 30000 ms）から読みます。test（`submit_excluded`）は免除です。**この値は暫定です。本番前に Owner が確定してください。**

### 保存（Spreadsheet）

- 列は `survey.schema.json` の `persistenceSchema.systemFields`（`timestamp` / `survey_version` / `schema_version` / `design_version` / `response_mode` / `test_run_id` / `respondent_hash` / `completion_status` / `source_channel` / `client_elapsed_ms` / `notification_status`）を**唯一の正本**とし、続けて全設問 ID（schema 順）と `other_texts`（JSON）です。`created_at` など schema に無い別名列は Public GAS 側で増やしません。列の追加が必要なら先に schema（#378）を更新します。
- 単一選択・scale は stable ID（scale は文字列 `"1"`〜`"5"` / `cannot_rate`）、複数選択は `|a|b|` 形式です。`respondent_hash` と選択肢列は Sheets の自動数値変換を避けるため書式を文字列にします（`setupSpreadsheet()` が設定）。
- `responses` シートのヘッダーが schema と完全一致しない場合は**書き込みを拒否**します（既存 survey の Sheet への誤書き込み防止）。
- **Formula Injection 対策**: `=` `+` `-` `@` と制御文字で始まる文字列は先頭に `'` を付けて保存します。
- 保存は `LockService`（ScriptLock）内で「重複判定 + append」を一体で行います。ロックを取得できなかった同時 submit は保存せず `server_error`（再試行可）を返します。

### 匿名重複抑止（respondent_hash）

browser UUID + server salt（Script Property `RESPONDENT_SALT`）から生成します。raw UUID は Sheet・ログ・応答に出しません。

hash 入力は**canonical serialization**（固定順の配列を `JSON.stringify`）で、要素境界を一意にします。無区切り連結はしません。

```text
["snb-respondent-hash", 1, <survey_id>, <response_mode>, <test_run_id>, <uuid(小文字)>, <salt>]
```

- production は `test_run_id` を空文字として直列化します。`response_mode` を含むため production / test の重複判定は混ざりません。
- `submit_excluded` は `test_run_id` を含めます。同じブラウザでも `test_run_id` が違えば別テスト回答として保存でき、同一 `test_run_id` 内では production と同等に重複を抑止します。

**重複抑止は完全な本人認証ではありません。** ブラウザの保存領域の消去・別端末・シークレットウィンドウ等で回避できます。「同一ブラウザからの意図しない二重送信・単純な連投を抑える」ことが目的です。

### source_channel

private な system field です。`x / line / website / instagram / email / direct / unknown`（`persistenceSchema.sourceChannel.allowlist`）のみ保存し、未指定・allowlist 外・型違いは `unknown` にします（受信値は保存しません）。個人単位の campaign code やユーザー識別値を入れないでください。

### 受付期間

`survey.config.json` の `reception.opens_at` / `closes_at` / `timezone`（`Asia/Tokyo`）が正本で、**server が最終権威**です。`opens_at` 前・`closes_at` 後の production submit を拒否します（両端は受付中）。この判定は #380 が持ち、#383（finalize）は再実装しません。

- `opens_at` / `closes_at` は `+09:00` 付き ISO 8601（秒まで）で指定します。例: `2026-11-01T00:00:00+09:00`
- 現在は **`null`（未設定）で、production は fail closed（`survey_not_configured`）** です。本番開始前に Owner が確定し、`npm run build` → commit → deploy してください。
- 次の場合も `survey_not_configured` になります: 片方だけ未設定 / 形式不正 / `opens_at >= closes_at` / `timezone` が `Asia/Tokyo` 以外 / schema の `respondentNotice.retention.status` が `must_set_before_launch` のまま（保持期限未確定の launch blocker）。

### test mode

| mode | 経路 | 保存 | 通知 | 備考 |
|---|---|---|---|---|
| `production` | server | する | する（有効時） | 受付期間・最短回答時間を検査 |
| `preview_no_submit` | client-only | しない | しない | Public GAS の保存 API 対象外 |
| `closed_view` | client-only | しない | しない | Public GAS の保存 API 対象外 |
| `submit_excluded` | server | `response_mode=test` + `test_run_id` | しない | production と同じ validation / Lock / 保存経路。production count・Admin 標準集計・public 結果・finalize から除外 |

- `submit_excluded` は POST body の `test_token` を `TEST_TOKEN`（Script Property）と照合して確定します。`TEST_TOKEN` が未設定・短い（24文字未満）場合は全て拒否（fail closed）。token は query string に置かず、ログ・Sheet・通知にも出しません。Frontend 側の取得方法（fragment → sessionStorage → POST body）は #381 で実装します。
- `test_run_id` は必須（`^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$`）。test 送信は受付期間・最短回答時間の対象外なので、公開前にも確認できます。
- 保存列 `completion_status` は保存した回答すべてで `complete` です（旧 survey の `completion_status='test'` / `LIVE_TEST_ENABLED` は使いません）。本番集計の絞り込みは `response_mode == 'production'` です。

### 通知

`survey.config.json` の `notification.enabled` で明示します（現在 `true`）。無効にする場合は `false` にします。暗黙の未実装にはしません。

- production の有効回答を**保存した後**だけ、運営者（`NOTIFICATION_EMAIL`）へ text/plain で「新規有効回答1件・受信日時・本番累計件数」を送ります。個票・自由記述本文・UUID・hash は載せません。
- test mode・18歳未満・検証失敗・重複・受付期間外では送りません。
- 送信失敗・宛先未設定でも回答の保存は成功のままです（`notification_status` が `failed` になります）。
- `notification_status`: `pending`（送信前の一時値）→ `sent` / `failed`、`disabled`（`enabled=false`）、`not_applicable`（test）。

### Setup と Script Properties

1. 新規 Spreadsheet を作り、Apps Script プロジェクトにバインドせずに ID を控えます（既存 survey の Sheet は使いません）。
2. 次の Script Properties を手動で設定します。**値はリポジトリ・GitHub Secrets・workflow・ログに出しません。**

| Script Property | 内容 |
|---|---|
| `SPREADSHEET_ID` | 上記の新規 Spreadsheet の ID |
| `RESPONDENT_SALT` | `setupScriptProperties()` が生成（既存値は上書きしない） |
| `TEST_TOKEN` | `submit_excluded` 用の十分長いランダム値（24文字以上）。Owner が安全な経路で Frontend/運用者へ共有 |
| `NOTIFICATION_EMAIL` | 運営者の宛先（`notification.enabled=true` のとき） |

3. Apps Script エディタで `setupScriptProperties()` → `setupSpreadsheet()` を実行します（Web App からは呼べません）。
4. Web App として初回デプロイし（実行ユーザー: 自分、アクセス: 全員）、`/exec` URL を Frontend（#381）に渡します。受付期間は Script Properties ではなく `survey.config.json` に設定します。

### Deploy workflow

`.github/workflows/baseball-uniform-survey-public-gas.yml`（他 survey の workflow / Environment / Secret とは独立）。

- **Pull request**: `npm run validate` / `npm run build:check` / `npm test` / 配備バンドルの dry-run のみ。secret を使わず、本番 deployment は更新しません。
- **本番 deploy は `workflow_dispatch` の明示操作のみ**（main 限定、対象は実行時点の `github.sha`）。`verify` → `deploy` の順で、`deploy` は GitHub Environment `baseball-uniform-survey-public-production`（main 限定・承認者あり）の承認を要します。
- `deploy` は `clasp pull` で既存プロジェクトを検証（別 survey / 手書きコードなら拒否）→ allowlist のファイルを push → version 作成 → **既存 deployment だけ**を更新します。新規 deployment は作らず、Script Properties・Web App のアクセス設定には触れません（`/exec` URL は変わりません）。

必要な GitHub Environment Secrets（`baseball-uniform-survey-public-production`）:

| Secret | 内容 |
|---|---|
| `CLASPRC_JSON` | clasp の認証 JSON |
| `BASEBALL_UNIFORM_SURVEY_SCRIPT_ID` | 対象 GAS の Script ID |
| `BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID` | 既存 Web App の Deployment ID |

salt / test token / 通知先はここには置かず、Apps Script の Script Properties にのみ置きます。

## 検証とテスト

Node.js 22 以上。依存パッケージはありません。

```bash
cd baseball/gas/baseball_uniform_survey
npm run validate   # tools/validate-schema.js: 参照整合 validation
npm test           # node --test tests/*.test.js
```

`tools/validate-schema.js` が検査する項目:

- question ID / option ID の重複
- `showIf` の question / option 参照、`equals / in / hasAnyExcept` などの演算子と設問型の整合
- `conditionRef` の参照切れ・循環（`conditions` 内を含む）
- `sourceQuestion` の参照切れ・型・定義順、`excludeOptionIds`
- dynamic option 由来の設問は `sourceQuestion` から option を導出して検査（静的 option 検査で誤検知しない）
- `semanticCodes.primary / secondary[]` と `reassuranceFor` が `barrierCodes` に定義済み
- `publicResultsOrder` の参照切れ・重複、public 設問との過不足
- 地方 block 集計の option 割り当て
- `routeUx.flow` / `sectionUx` の question 参照
- section の欠落
- `ordinal:true` と `sort` の同時指定の拒否
- `publication` 欠落、public の `minCell >= 3`、branch public の `minTarget >= 10`、sensitive branch の `minTarget >= 20`
- 低関心 route の trigger 3 参照が `catchball_interest` の実在 option と一致
- `testModes` の client-only / server 検証の分類と本番集計からの除外

`tests/core.test.js` は専用 core の unit test です（condition の `all / any` ネスト・`conditionRef`・各演算子と fail-safe、`single_dynamic`、low-interest route、`activity_stopped_reasons` / `adult_context` の2条件、hidden 後の stale 値除去、required は visible のみ、multiple exclusive、other_text、scale + notApplicable、ordinal 順、publication、`targetCount = question_reached`、test mode 分離）。

`tests/public_submit.test.js` は Public GAS の unit/integration test（Apps Script API は最小フェイク。valid submit・hidden/unknown/stale/invalid option 拒否・18歳未満・hash namespace と canonical 入力・duplicate・concurrent・source_channel・最短回答時間・受付期間・test token・notification・Formula Injection）、`tests/public_build.test.js` は生成物の整合、`tests/deploy.test.js` は配備構成と workflow の検査です。

`tests/schema.test.js` は実 schema に対する検査と v2.17 の回帰（低関心 route の 3 参照、`activity_stopped_reasons`、`adult_context`、`exercise_*`）、
`tests/validator.test.js` は validator が壊れた schema を検出することの負例テストです。

CI: `.github/workflows/baseball-uniform-survey-schema.yml`（schema の参照整合）と `.github/workflows/baseball-uniform-survey-public-gas.yml`（Public GAS）が PR ごとに上記を実行します（PR では deploy・secret は使いません）。

## 公開 repo 上の注意

GitHub Pages は repository 全体を公開対象にします。このディレクトリには次を置きません。

- 実回答、CSV、Spreadsheet export、個票、free text dump、実データの test fixture
- salt / token / secret（server-side の Script Properties 等にのみ置く）

テストの入力は schema をメモリ上で書き換えた架空データだけです。
