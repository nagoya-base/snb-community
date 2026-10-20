# 名古屋野球ユニ部アンケート（design v2.18）

親Issue #377 / 本ディレクトリの範囲は Issue #378（schema 正本の配置・参照整合 validation・CI）、Issue #379（専用 survey-core の fork と v2.17 構文対応）、Issue #380（Public GAS・保存・匿名重複抑止・server validation・test mode・受付期間・通知・deploy workflow）です。
Issue #381 で回答 Frontend（`baseball/baseball-uniform-survey.html` と `baseball/baseball-uniform-survey/`）・route 進捗 UX・test UI・GA4 最小計測・analytics.js の section_view opt-out を追加しました（下記「Frontend」）。
Issue #382 で Admin 集計・publication 判定・small-cell / complementary suppression・privacy-safe snapshot・公開結果ページを追加しました（下記「Admin と公開結果」）。
Issue #383 で maintenance GAS（retention・close 後 finalize・final snapshot 固定・cleanup）を追加しました（下記「maintenance・retention・finalize・cleanup」）。

## 正本

| ファイル | 役割 |
|---|---|
| `survey.schema.json` | design v2.17。設問・option・分岐・publication・semantic code の**唯一の正本** |

- `design_version = 2.18` / `survey_id = nagoya_baseball_uniform_club_2026` / `survey_version = 2026-10`
- 設問・option・分岐条件を各コードへベタ書きせず、必ずこの schema を参照します。
- 長期離脱の判定は文章で再定義せず、`conditions.lapsed_attendee` を唯一の正本とします。
- 公開設定は各 question の `publication` object のみを正本とします。
- `testModes.activation`: `preview_no_submit` / `closed_view` は回答を server へ送らない client-only preview（submit 用 test token 検証は不要）。`submit_excluded` のみ server へ送信し、server が test token を検証して mode を確定します。
- `respondentNotice.retention.status` は `confirmed`（`retention.config.json` と整合。保持期限の数値は schema には書かず `retention.config.json` が正本。Owner 確定: `closes_at` から 365 日）です。

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
- **最短回答時間**は production のみ検査し、閾値は `survey.config.json` の `validation.minElapsedMs`（現在 60000 ms）から読みます。test（`submit_excluded`）は免除です。60秒は「通常の回答時間」ではなく、明らかに機械的・不可能に近い送信だけを弾く安全弁として確定した値です。90秒以上にすると短い分岐や速い回答者を誤って落とすため上げません。

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
  - 正しい `TEST_TOKEN` + 有効な `test_run_id` の `submit_excluded` は、production の受付状態が `not_configured` / `not_open` / `closed` のいずれでも保存されます（`opens_at` / `closes_at` を仮設定する必要はありません）。production 送信は従来どおり受付判定が必須で、`survey_not_configured` / `survey_not_open` / `survey_closed` で拒否します。token が不正・未設定・24文字未満の場合は受付状態に関わらず拒否します。
  - Frontend は `endpoint` を読み込み時に固定せず、status 取得・送信の時点で `BASEBALL_UNIFORM_SURVEY_CONFIG.endpoint` を読みます（ローカル override で後から設定しても、test 送信が「準備中」で止まりません）。test mode は起動時に通信しないため、endpoint 未設定は送信時にだけ判明します。
- 保存列 `completion_status` は保存した回答すべてで `complete` です（旧 survey の `completion_status='test'` / `LIVE_TEST_ENABLED` は使いません）。本番集計の絞り込みは `response_mode == 'production'` です。

### 通知

`survey.config.json` の `notification.enabled` で明示します（現在 `true`）。無効にする場合は `false` にします。暗黙の未実装にはしません。

- 通知条件は `production && valid && saved && notification.enabled && support_message.trim() !== ''` です。通常の回答、`feedback`、「その他」自由記述だけでは送りません。
- 送るのは回答を**保存した後**だけで、運営者（`NOTIFICATION_EMAIL`）へ text/plain で「受信日時・本番累計件数・`support_message` 本文」だけを送ります（件名: `名古屋野球ユニ部アンケート｜応援・激励メッセージ`）。他の回答・feedback・「その他」本文・UUID・hash は載せません。
- test mode（`support_message` があっても）・18歳未満・検証失敗・重複・受付期間外では送りません。
- 送信失敗・宛先未設定でも回答の保存は成功のままです（`notification_status` が `failed` になります）。
- `notification_status`: `pending`（送信前の一時値）→ `sent` / `failed`、`disabled`（`enabled=false`）、`not_required`（production だが `support_message` が空白のみ／未入力）、`not_applicable`（test）。

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

target ごとに専用 workflow・専用 bundle allowlist・専用 Environment / Script ID / Deployment ID を持ちます（他 survey の workflow / Environment / Secret とは独立）。Public / Admin / maintenance の初回 clasp push は、専用の bootstrap workflow `baseball-uniform-survey-bootstrap-gas.yml`（`public` / `admin` / `maintenance` target・専用 Environment / bootstrap Script ID）でも行えます（空の初期 project への push のみ。Web App deployment・OAuth 承認・Script Properties は手動）。一覧と bootstrap 手順は [`LAUNCH_READINESS.md`](LAUNCH_READINESS.md) の「2. deploy 準備」を参照してください。

| target | workflow |
|---|---|
| Public | `.github/workflows/baseball-uniform-survey-public-gas.yml` |
| Admin | `.github/workflows/baseball-uniform-survey-admin-gas.yml` |
| maintenance | `.github/workflows/baseball-uniform-survey-maintenance-gas.yml` |

以下は Public の説明です（Admin / maintenance も同じ流れで、加えて `webapp_access_set_to_myself` の確認入力が必須）。

- **Pull request**: `npm run validate` / `npm run build:check` / `npm test` / 配備バンドルの dry-run のみ。secret を使わず、本番 deployment は更新しません。
- **本番 deploy は `workflow_dispatch` の明示操作のみ**（main 限定、対象は実行時点の `github.sha`）。`verify` → `deploy` の順で、`deploy` は GitHub Environment `baseball-uniform-survey-public-production`（main 限定・承認者あり）の承認を要します。
- `deploy` は `clasp pull` で既存プロジェクトを検証（別 survey / 手書きコードなら拒否）→ allowlist のファイルを push → version 作成 → **既存 deployment だけ**を更新します。新規 deployment は作らず、Script Properties・Web App のアクセス設定には触れません（`/exec` URL は変わりません）。

**本番 deploy 前の手動準備**（PR・workflow では作成しません）: GitHub Environment `baseball-uniform-survey-public-production`（main 限定・承認者あり）を作り、次の Secrets を登録します。

必要な GitHub Environment Secrets（`baseball-uniform-survey-public-production`）:

| Secret | 内容 |
|---|---|
| `CLASPRC_JSON` | clasp の認証 JSON |
| `BASEBALL_UNIFORM_SURVEY_SCRIPT_ID` | 対象 GAS の Script ID |
| `BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID` | 既存 Web App の Deployment ID |

salt / test token / 通知先はここには置かず、Apps Script の Script Properties にのみ置きます。

## Frontend（Issue #381）

回答ページは `baseball/baseball-uniform-survey.html`、アセットは `baseball/baseball-uniform-survey/` です（既存 `community/costume-portrait-survey*` は変更しません）。ビルド不要の静的ページで、GitHub Pages から配信されます。

| ファイル | 役割 |
|---|---|
| `baseball/baseball-uniform-survey.html` | 回答ページ。`<body data-disable-section-view="true">`、公開前は `noindex` |
| `baseball/baseball-uniform-survey/app.js` | 描画・route 進捗・Public GAS 連携・test UI・GA4（許可イベントのみ） |
| `baseball/baseball-uniform-survey/test-mode.js` | test mode 判定（GA4 初期化より前に同期実行） |
| `baseball/baseball-uniform-survey/config.js` | Public GAS の `/exec` URL（`endpoint`） |
| `baseball/baseball-uniform-survey/styles.css` | survey 専用スタイル（baseball の配色） |
| `baseball/baseball-uniform-survey/survey.generated.js` | **生成物（直接編集禁止）**。`SURVEY_SCHEMA` + 専用 core |

### build / test

```bash
cd baseball/gas/baseball_uniform_survey
npm ci               # jsdom（lockfile 固定）
npm run build        # public/SurveyGenerated.gs と baseball/baseball-uniform-survey/survey.generated.js を再生成
npm run build:check  # 両生成物と正本（schema + config + core）の差分検出（npm test にも含まれ、CI で実行）
npm test             # schema / core / Public GAS / Frontend(jsdom) / analytics opt-out / deploy
```

Frontend 用の生成物は schema と core だけを埋め込みます（`survey.config.json`・受付期間・通知設定は含みません）。設問・option・分岐条件は HTML/JS へベタ書きせず、`SurveyCore` が表示・required・検証を判定します。画面の見出し（`SECTION_TITLES`）は UI 文言で、schema の section ID と 1:1 です（欠けるとテストが失敗します）。

### Public GAS URL の設定

GAS の初回デプロイ後、`baseball/baseball-uniform-survey/config.js` の `endpoint` に `/exec` URL を設定します。空の間は「現在準備中です」を表示し、通信しません。受付状態は必ず `GET ?action=status`（`open` / `not_open` / `closed` / `not_configured`）から取得し、Frontend で受付期間を判断しません。`status` に到達できなくても入力画面は出し、最終判断は送信時に server が行います（`survey_not_open` / `survey_closed` / `survey_not_configured` / `duplicate_submission` / `schema_mismatch` / `invalid_request` は回答者向けの文言に変換し、内部のエラーコードは表示しません）。

### 回答の流れ・低関心 route

intro → section ごとのページ → 確認 → 完了。回答は最後にまとめて送信します。hidden になった設問は DOM から取り除き（tab 順にも残りません）、値は直ちに消します。送信前には Frontend だけが `SurveyCore.sanitizeAnswers` を通し、server は受信 payload をそのまま検証します。`age_confirmed` が 18 歳未満の場合は回答を破棄して終了し、server へは何も送りません。

`catchball_interest` が `low_interest` / `not_interested` の人には `uniform_social_interest` を表示し、キャッチボール会の細かな運営条件は省きます。運動頻度・運動の動機（該当者には継続要因）・年代・地域・自由記述は残ります（低関心を分析対象外にしません）。

### 進捗

分母は最長 route ではなく、その回答者の visible route です（「現在 3/8 セクション」「全体の約40%」「残り約4分」）。割合・残り時間は route が確定してから表示し（確定前は「現在 N セクション目」のみ）、表示は単調です（後退しません）。所要時間は「5〜12分程度」で統一しています。`SECONDS_PER_QUESTION`（`app.js`）は残り時間の見積もり用の目安で、実測に応じて調整できます。進捗・section 名・route 名は GA4 へ送りません。

### test mode の使い方

test mode は **URL fragment**（`#...`）で指定します。query string には置きません。fragment は読み取り直後に `sessionStorage` へ移し、URL から取り除きます（履歴・共有 URL・GA4 の page_location に残しません）。同じタブでは再読み込みしても継続し、バナーの「テストを終了」で解除できます。test mode では **GA4 を初期化せず、本番 GA4 へ一切送りません**。

| URL | 動作 |
|---|---|
| `.../baseball-uniform-survey.html#test=preview_no_submit` | client-only。入力 → 確認 → 完了画面まで確認できる。通信なし・保存なし |
| `.../baseball-uniform-survey.html#test=closed_view` | client-only。受付終了の表示だけを確認する。通信なし |
| `.../baseball-uniform-survey.html#test=submit_excluded&token=<TEST_TOKEN>&run=<test_run_id>` | server へ test として送信（`response_mode=test`。本番 count・通知・公開結果・finalize から除外）。完了画面は「テスト送信を受け付けました（集計対象外）」で、本番の完了と区別できる |

- `token` は #380 の Script Property `TEST_TOKEN`。Frontend は `sessionStorage` から POST body の `test_token` にだけ載せ、DOM・ログ・GA4・URL・query string には出しません。
- `run`（`test_run_id`）は `^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$`。省略すると `run_<12桁hex>` を生成します。同じ `test_run_id` では本番と同じ重複抑止が働くため、再度試すときは新しい `run` で開き直します。
- **fail closed**: test 指定（fragment の `test=` / `token=` / `run=`、保存済みの test 状態、query string の `test=`）を検出したのに検証できない場合（未知の mode・token 欠落・不正な `run`・壊れた保存値）は、production に戻りません。GA4 なし・status GET なし・POST なしで「テスト用URLの設定が正しくありません」だけを表示します。URL の誤記で本番回答として起動・送信される事故を防ぐためです。この状態はリロードでも維持され、バナーの「テストを終了」で解除します。`preview_no_submit` / `closed_view` は誰でも開けますが何も保存しません。`submit_excluded` は token を server が検証します。
- 流入元は `?src=<x|line|website|instagram|email|direct|unknown>`（allowlist のみ）を `source_channel` として送ります。個人別の code は送りません。

### GA4

survey ページで送るのは `form_start` / `form_error`（error type のみ）/ `survey_submit`（server 保存成功後のみ）だけです。`section_view`・設問 ID・section ID・route ID・branch ID・進捗・回答値・年代/地域・自由記述・UUID・hash・test token/run は送りません。`data-section-view` / `data-cta-name` などの自動計測属性も survey に付けません。

共有 `analytics.js` には、ページ単位の opt-out を追加しました。`<body data-disable-section-view="true">` のページでは `trackSectionView` / `track('section_view')` / `data-section-view` の自動計測を行いません（他のイベントと、フラグの無い既存ページの `section_view` は従来どおりです。`tests/frontend.test.js` に回帰テストがあります）。

### 手動確認（ローカル/CI で自動化できない項目）

次は親 #377 の最終確認として残ります（iOS Safari・実 Web App・実 Spreadsheet を伴う E2E）。

1. `config.js` に実 `/exec` URL を設定し、`GET ?action=status` の各状態（受付前・受付中・終了・未設定）の表示を確認する。
2. `#test=submit_excluded&token=...&run=...` で test 送信 → Spreadsheet に `response_mode=test` と `test_run_id` で保存され、本番 count・通知に入らないことを確認する。
3. production で 1 件送信 → `response_mode=production` で保存、通知（有効時）、GA4 DebugView に `form_start` / `survey_submit` だけが出る（`section_view` と回答値が出ない）ことを確認する。
4. iOS Safari と Android Chrome で 390px 幅の表示・キーボード・固定ナビを確認する。

## Admin と公開結果（Issue #382）

| ファイル | 役割 |
|---|---|
| `src/survey-aggregate.js` | 集計・publication 判定・suppression・snapshot 生成・検証・semantic code 集計（副作用なしの ES5。`SurveyCore` を使う） |
| `admin/` | 独立した **read-only** Admin GAS（`SurveyGenerated.gs` は生成物。`Config / Data / Snapshot / FreeText / Main .gs`、`Dashboard.html`、`appsscript.json`） |
| `baseball/baseball-uniform-survey-results.html` と `baseball/baseball-uniform-survey-results/` | 公開結果ページ（`results.js` / `results.css` / `snapshot.json` / 生成物 `results-i18n.generated.js`） |
| `tools/build-initial-snapshot.js` | 回答 0 件の初期 `snapshot.json`（全項目非公開）を作る。実データには触れない |

設問ID・option・分岐・公開閾値は Admin / aggregate にベタ書きしません。`question.publication` が公開判定の**唯一の正本**です（`publicRegionAggregation.publication` は地域ブロック用）。`npm run build` は `admin/SurveyGenerated.gs`（schema + 専用 core + aggregate。受付設定・通知設定・salt/token は含めない）も生成し、`build:check` が差分を検出します。

### Admin GAS（read-only）

- OAuth scope は `spreadsheets.readonly` のみ。Web App は `executeAs: USER_DEPLOYING` / `access: MYSELF`（運営責任者 1 名）。Public GAS の bundle には含めず、専用 workflow `baseball-uniform-survey-admin-gas.yml`（Environment `baseball-uniform-survey-admin-production`、専用 Script ID / Deployment ID）で既存 deployment を更新します。初回の project 作成・OAuth 承認・Script Properties・最初の Web App deployment は手動 bootstrap です。
- responses の読み取りは `SpreadsheetApp.open*`（フル `spreadsheets` scope が必要）ではなく Advanced Sheets サービス（`Sheets.Spreadsheets.Values.get`、Sheets API v4）で行い、scope は `spreadsheets.readonly` のまま動きます。manifest の `dependencies.enabledAdvancedServices`（`Sheets` / `v4`）に加え、deploy はリモート manifest の `dependencies` を保持するため、**初回 bootstrap で Apps Script エディタの「サービス」から Sheets API を追加**し、紐づく GCP project で Sheets API を有効にしてください。Admin には書き込み API（`values.update` 等）も `UrlFetchApp` も持たせません（`tests/admin_gas.test.js` が `SpreadsheetApp` の再混入を検査します）。
- Script Property `RESPONSES_SPREADSHEET_ID`（#380 の responses Spreadsheet。値はリポジトリに置かない）を手動で設定します。`responses` シートのヘッダーが schema と完全一致しなければ読みません。
- 回答の編集・削除・手動書き換えの UI / endpoint はありません。唯一の書き込みは自分自身の Script Property `SNAPSHOT_STATE`（最後に公開した snapshot の生成時刻と件数）です。
- 画面: production valid total ／ test 除外件数と除外内訳 ／ 設問ごとの `targetCount` と `minTotal / minTarget / minCell` の達成・未達 ／ 抑止後の public preview ／ 障壁と安心条件の比較 ／ snapshot 生成。自由記述は別タブ「自由記述（運営者のみ）」で明示的に読み込んだときだけ取得します（`FreeText.gs`。`Snapshot.gs` と `buildSnapshot` は呼びません）。個票・`respondent_hash` は返しません。

### 集計対象（production 有効回答）

`classifyRows` が行を次のように分けます。標準集計・public snapshot に入るのは `production_valid` だけです。

| 区分 | 条件 |
|---|---|
| `test_excluded` | `response_mode = test`（invalid でも test として数える。通常集計・snapshot・件数に影響しない） |
| `excluded.unknown_response_mode` | `production` / `test` 以外・空（fail-closed） |
| `excluded.incomplete` / `version_mismatch` | `completion_status != complete` ／ survey・schema・design version が schema と不一致 |
| `excluded.ineligible` / `schema_invalid` / `malformed` | 18歳未満（`termination`）／ `validateAnswers` 失敗／ `other_texts` が壊れている |
| `excluded.missing_hash` / `duplicate` | `respondent_hash` が空／ 同一 hash（最初の 1 件だけ採用。hash は重複除去の内部用途のみ） |

自由記述（text 設問）は valid record の `answers` から `free_text` へ分離され、「その他」本文は `other_texts` に残ります。`buildSnapshot` は `answers` だけを読みます。

### denominator と publication 閾値

- `targetCount` は schema の `denominator: question_reached` で、**その設問に実際に到達した有効回答者数**（`SurveyCore.countQuestionReached` と同じ概念。回答済み人数ではありません）。
- 判定は `evaluatePublication`：`production valid total >= minTotal` かつ `targetCount >= minTarget` で `published`。未達は `insufficient`、`sensitiveBranch: true` の設問は `sensitive_withheld`（参加経験者評価など。**未達のまま調査が終わっても仕様違反ではない**）。`sensitiveBranch` の `minTarget` は schema が緩んでも 20 を下回りません（`SENSITIVE_BRANCH_MIN_TARGET`）。
- 基準値: early_factual `minTotal 10 / minTarget 10 / minCell 3`、bias_sensitive `30 / 10 / 3`、sensitive branch `30 / 20 / 3`（いずれも schema の値を参照）。
- 閾値未達の項目の snapshot には `targetCount: null`・`cells: []` だけを出し、0 件表示や推測できる数値を出しません。

### suppression 方式

1. **small-cell**: `0 < count < minCell` のセルは値を出さない。
2. **complementary**: 単一選択・scale・地域（partition）は、小セルがあれば「最小の公開セル」も（データに依らずちょうど 1 つ）隠す。そのうえで、公開出力（公開セル・隠した合計・隠しうるセルの位置）と整合する元の件数が、どの隠しセルについても 2 通り以上あること（`ambiguityHolds`）を確認する。**合計が `minCell` 以上・2 セル以上というだけでは足りません**（`minCell=3` で小セルが 2・2 なら合計 4 から 2+2 に確定する）。確認できない並びは何も公開せず `suppressed_all` にする。多選択はセルの合計が `targetCount` と一致しないため補完は不要。
3. **ordinal** は目盛りを保つため、隠したセルも位置だけ残し `count: null, suppressed: true`。**nominal** は隠したセル・ゼロセルを出力から除く（隠したのかゼロなのか区別させない）。ゼロを `0` として出すのは `showZeroCells: true` のときだけ。
4. 並び: ordinal は schema の順（scale は min..max のあと尺度外の `cannot_rate`）。nominal は `sort: count_desc`、同数は schema の option 順（`tieBreak`）。
5. **地域**: 詳細都道府県・愛知県内地域は private。`publicRegionAggregation` のブロックだけを出し、少数ブロックと最小の公開ブロック 1 つを「その他の地域」にまとめ、2 通り以上の元の件数が整合することを同じ規則で確認する。公開ブロックが残らない・確認できない場合は `suppressed_all`。

`validateSnapshot` が上記の不変条件（公開出力から隠したセルの元値が一意に決まらないこと、隠した合計 `targetCount − 公開セルの合計` が 0 または `minCell` 以上、ordinal の隠しセルが 2 つ以上、`minCell` 未満の値がない、順序、publicResultsOrder、schema version、private 情報の混入）を検査します。Admin は snapshot 生成時に必ずこれを通します。

### public snapshot schema（`snapshot.json`）

```text
{
  snapshot_version, survey_id, survey_version, schema_version, design_version,
  generated_at,
  response_status: { state: 'collecting' | 'counting', label },   // 10件未満は「回答受付中」、以上は「N件以上」
  production_valid_total: null | 10の倍数(切り下げ),                 // 正確な件数は出さない
  representativeness_notice, sections: [{id, label}],            // 現在の回答状況 / アンケート結果
  questions: [{ id, label, section, tier, type, ordinal,
                state: published | insufficient | sensitive_withheld | suppressed_all,
                targetCount: number | null,                      // published のときだけ
                cells: [{id, label, count | null, suppressed?, independent?, merged?}],
                hasSuppressedCells }]                            // publicResultsOrder の順
}
```

`generated_at` 以外に時刻・識別子は含みません。`region_blocks` は地方ブロック集計の疑似 question id です。

**public に絶対出さないもの**: 自由記述（feedback / support_message）・海外在住時の国・地域名（`residence_country`）・「その他」本文・個別回答・詳細都道府県・愛知県内地域・`respondent_hash`・UUID・個別 timestamp・`source_channel` その他 system field・private 設問の ID。

### snapshot の batch 更新（submit ごとに更新しない）

公開結果ページは Spreadsheet も Public GAS も読まず、`baseball/baseball-uniform-survey-results/snapshot.json` だけを読みます。**回答の送信では何も更新されません**（Public GAS は変更していません）。公開手順:

1. Admin の「snapshot」タブで「snapshot を生成」。更新判定（`decideSnapshotUpdate`）が「更新してよい」のときだけ進める。
2. 生成された JSON を `baseball/baseball-uniform-survey-results/snapshot.json` として PR で commit する（cache が切り替わるのはこのときだけ）。
3. 公開後に「公開した snapshot として記録」を押す（`SNAPSHOT_STATE` に生成時刻と件数を記録）。

更新判定は `publicationPolicy.snapshotUpdate` に従い、原則 1 日 1 回、または件数増分が `countTriggerIncrement` 以上のとき。どちらも増分が `minCell`（および `minimumBatchIncrement`）以上でなければ更新しません（連続する snapshot の差分から少数の回答が推測されるのを防ぐため）。時刻トリガーによる自動更新・自動 commit は今回は作っていません。

### 公開結果ページ

`baseball/baseball-uniform-survey-results.html`（公開前は `noindex`。回答ページと同時に外す）。「現在の回答状況」「アンケート結果」の 2 層で、SNS/Web 等で募った任意回答で一般人口を代表しないこと・小さい集計群は非表示にすること・自由記述と詳細地域は公開しないことを明記します。設問ごとの対象者数も回答件数と同様に 10 人単位に切り下げて表示します（各セルの人数は正確に表示します。割合は正確な `targetCount` から計算します）。sensitive branch が閾値に達していない項目は、空白やエラーではなく「この項目は、十分な回答数が集まった場合のみ公開します。」を表示します。GA4 は読み込みません。Frontend（#381）の完了画面は `RESULTS_URL = 'baseball-uniform-survey-results.html'` でこのページへリンクします（test mode の完了画面には出しません）。

### semantic code 集計（Admin 分析のみ）

`analyzeSemanticCodes` が schema の `semanticCodes`（障壁）と `reassuranceFor`（安心条件）を使い、code ごとに**回答者単位**で数えます。同じ回答者が同じ code に複数の option（primary と secondary の重複を含む）から該当しても 1 人です（設問ごとに code の集合を作ってから数える）。障壁（`barriers` / `pre_attendance_worries` / `attendance_lapse_reasons` / `activity_stopped_reasons`）と安心条件（`participation_conditions`）を code ごとに並べて比較でき、安心条件が未設計の code も分かります。自由記述の自動分類はしません。この集計は public snapshot には出しません。

## maintenance・retention・finalize・cleanup（Issue #383）

| ファイル | 役割 |
|---|---|
| `src/maintenance-core.js` | finalize / retention / cleanup の判断ロジック（副作用なしの ES5。Spreadsheet・Script Properties は ports 経由。`SurveyAggregate` を再利用） |
| `maintenance/` | 独立した maintenance GAS（`SurveyGenerated.gs` は生成物。`Config / Data / Finalize / Retention / Cleanup / Main .gs`、`Maintenance.html`、`appsscript.json`） |
| `retention.config.json` | retention 設定の正本（`confirmed` / `policy_version: 2026-10-v1` / `retention_rule: closes_at + 365日` / `keep_final_snapshot: true`） |

maintenance は Public GAS（#380）・Admin GAS（#382）とは**別 project・別 Script ID・別 Script Properties・別 Environment / Secret**です。通常の閲覧・回答受付経路からは呼ばれません（`doPost` なし）。書込み権限が必要な OAuth scope（`spreadsheets`）はこの project だけが持ち、Public / Admin の scope は広げていません。Web App は `executeAs: USER_DEPLOYING` / `access: MYSELF`（運営責任者 1 名）で、公開しません。本番 deploy は専用 workflow `baseball-uniform-survey-maintenance-gas.yml`（Environment `baseball-uniform-survey-maintenance-production`、専用 Script ID / Deployment ID）で、main からの `workflow_dispatch` + Environment 承認でのみ既存 deployment を更新します。初回の project 作成・OAuth 承認・Script Properties・最初の Web App deployment は手動 bootstrap です。

### 責務の境界

- production submit の受付可否（`opens_at` / `closes_at`）は **#380 Public GAS が唯一の権威**です。maintenance は第二の受付判定を持ちません。
- maintenance が `closes_at` を参照するのは、finalize を締切前に実行しないための **precondition** だけです（`closes_at` 未設定 → 拒否／現在時刻が `closes_at` 以前 → 拒否／timezone は `Asia/Tokyo`。`opens_at` / `closes_at` は `survey.config.json` の `reception` を生成物へ取り込んだものです）。
- 集計・publication 判定・suppression・snapshot 生成・検証は #382 の `classifyRows` / `buildSnapshot` / `validateSnapshot` をそのまま呼びます（別集計・別 suppression は持ちません）。

### 運営操作（maintenance Web App）

retention 設定状態の確認／finalize preflight／finalize 実行／finalized 状態の確認／final snapshot の表示／cleanup dry-run／cleanup 実行／manual_required の完了記録。回答を 1 件ずつ編集・削除する UI はありません。

### launch 前 retention checklist（production launch blocker）

`respondentNotice.retention.status = must_set_before_launch` と `retention.config.json` の `policy_status: unset` のどちらかが残る間は、production launch できません（Public GAS の受付状態も `not_configured` のまま）。2026-10 の launch で `retention.config.json` を `confirmed`（`closes_at` + 365 日）、schema の status を `confirmed` に確定しました。以下のチェックリストは確定時の手順です（設定を変える場合も同じ条件が適用されます）。

- [ ] **Owner: `nagoya-base`** が、実際の `opens_at` / `closes_at` 確定時（遅くとも production launch 前）に、`retention.config.json` を設定する PR を出す
  - `policy_status: confirmed`、`policy_version`、`retention_end_date`（`YYYY-MM-DD`。JST のその日の終わりまで保持）**または** `retention_rule`（`{"basis": "closes_at", "days": N}`）のどちらか一方
  - `keep_final_snapshot`（privacy-safe な final public snapshot を cleanup 後も保持するか）、`cleanup_operator`（実行者）、`verification_method`（実行確認方法）
  - `inventory_reviewed`: 下記 storage inventory の ID をすべて確認済みとして列挙（inventory が増えたら設定の更新が必要になります）
  - placeholder（`TBD` / `未定` / 空 / `must_set_before_launch` など）・期限が `closes_at` 以前・両方指定は `invalid` で fail closed です。
- [ ] 同じ PR（または launch 直前の PR）で `survey.schema.json` の `respondentNotice.retention.status` を `must_set_before_launch` 以外へ変更する（`retention` 設定が `confirmed` かつ schema の status が変更済みのときだけ、maintenance の `launch_ready` が `true` になります）
- [ ] **親 Issue #377 の Owner checkbox は launch 前の運用作業として手動で更新する**（この実装・maintenance は GitHub Issue 本文を変更しません）

### finalize（close 後に 1 回固定）

運用手順:

1. `closes_at` を過ぎたことを確認し、maintenance で **finalize preflight**（書き込みなし。production valid の exact count・除外内訳・final snapshot の SHA-256 digest・`confirmation_code` を返す）。
2. 結果を確認し、`confirmation_code` を貼って **finalize を実行**（`FINALIZE:<survey_version>:<digest 先頭 12 文字>`。preflight 後に回答が変わると code が一致せず実行できません）。
3. **finalized 状態を確認**（marker と保存済み snapshot の digest 照合）し、**final snapshot を表示**して内容を確認する。
4. 確認後、`baseball/baseball-uniform-survey-results/snapshot.json` を **operator が PR で反映する**。maintenance は GitHub へ自動 commit しません。

処理順（固定）: precondition → responses を read-only で再読込 → `classifyRows`（test / 18歳未満 / invalid / duplicate を除外）→ `buildSnapshot`（`generated_at` は `closes_at` に固定）→ `validateSnapshot` → survey / schema / design version・valid exact count・締切時刻の整合確認 → final snapshot を `final_snapshot` Sheet へ保存 → 読み戻して SHA-256 を照合 → **最後にだけ finalized marker を保存**。途中で例外が出ても marker は保存されません。

- final snapshot は #382 と同じ privacy-safe な JSON です（自由記述・「その他」本文・詳細都道府県・愛知県内地域・`respondent_hash`・UUID・system identifier を含まず、閾値未達の設問・sensitive branch は final でも数値を出しません）。`responses_valid` のような回答の複製 Sheet は**作りません**。
- final JSON は Script Properties ではなく `final_snapshot` Sheet（40,000 文字ごとのチャンク。各セルは先頭に `c:` を付けて数式・数値として解釈されないようにする）に保存します。Script Properties には marker と小さい metadata だけを置きます。
- **finalized marker**（Script Property `FINALIZED_MARKER`）: `finalized_at` / `survey_id` / `survey_version` / `schema_version` / `design_version` / `closes_at` / `production_valid_total`（Admin 内部の exact 値）/ `snapshot_digest`（SHA-256）/ `operator`（固定文字列 `nagoya-base`）のみ。個票・自由記述・hash・UUID・salt・token は入れません。許可キー以外を含む marker は `marker_invalid` として扱い、fail closed です。
- 同じ version + `closes_at` + digest で finalized 済みなら、`final_snapshot` Sheet の存在と SHA-256 一致を確認したうえで再実行は no-op 成功です。保存済み snapshot が欠損・改変されている場合は `final_snapshot_missing` / `final_snapshot_mismatch` で fail closed とし（成功扱いにしない・marker は書き換えない）、preflight も `would: inconsistent` と表示します。内容が異なる（回答が増えた・`closes_at` が変わった等）ときは自動上書きせず `finalized_conflict` で停止します。**incident 時も marker を手動で書き換えないでください**（原因を調べ、Owner が判断します）。

### storage inventory（回答由来データの保存先）

| ID | 内容 | 扱い |
|---|---|---|
| `responses_production` | responses Sheet の production 行（raw） | cleanup で削除 |
| `responses_test` | responses Sheet の test 行（`submit_excluded`。raw） | cleanup で削除（test mode も retention 対象） |
| `responses_unclassified` | `response_mode` が不明な行（raw） | cleanup で削除 |
| `responses_valid_sheet` | `responses_valid` 等の派生 Sheet（finalize は生成しない。手動で作られていれば） | cleanup で削除 |
| `final_snapshot_sheet` | privacy-safe な final public snapshot | `keep_final_snapshot` に従い保持／削除 |
| `maintenance_script_properties` | `FINALIZED_MARKER` / `MANUAL_CLEANUP_DONE` / `CLEANUP_AUDIT`（件数・日時・digest のみ） | 監査情報として保持 |
| `cache_service` | CacheService | Public / Admin / maintenance は使用しない（`not_used`。テストで静的に検査） |
| `admin_script_properties` | Admin GAS の `SNAPSHOT_STATE`（時刻と件数のみ） | **manual_required** |
| `public_script_properties` | Public GAS の `RESPONDENT_SALT` / `TEST_TOKEN` / `NOTIFICATION_EMAIL`（salt は削除して hash を再識別不能にする） | **manual_required** |
| `github_pages_snapshot` | GitHub Pages の `snapshot.json`（privacy-safe な公開 snapshot） | `keep_final_snapshot: true` なら保持。`false` なら **manual_required**（PR で削除） |
| `notification_and_execution_logs` | 通知メール・Apps Script 実行ログ等 | **manual_required** |
| `admin_export_copies` | Admin export 等のコピー（ダウンロード済みファイル含む） | **manual_required** |
| `external_tool_copies` | 外部 AI / 外部ツールへ渡した de-identified copy | **manual_required** |
| `spreadsheet_history_and_backups` | Spreadsheet の変更履歴・ゴミ箱・バックアップ・ダウンロード済みコピー（行削除後も残る） | **manual_required** |

コードから削除できない storage は「削除済み」と扱わず `manual_required` として dry-run に出します。

### cleanup（dry-run → 明示確認 → execute）

1. **cleanup dry-run**: 書き込みなし。retention policy / deadline・期限到達の有無・storage ごとの件数または有無・production / test・raw / derived / privacy-safe snapshot の区別・final snapshot を保持するか削除するか・`manual_required` の完了状態・実行可否（`can_execute` と `blockers`）を返します。**件数と storage 名だけで、回答本文・自由記述・hash は画面にも Logger にも出しません。**
2. 内容を確認し、`confirmation_code`（`CLEANUP:<policy_version>:<計画の digest 先頭 12 文字>`。dry-run 後に件数・方針が変わると一致しません）を貼って **cleanup を実行**。
3. execute は、retention 未確定（`retention_policy_not_confirmed`）・期限前（`retention_not_reached`）・`keep_final_snapshot: true` なのに finalize 済みでない（`final_snapshot_required`）・confirmation なし／不一致のとき拒否します。LockService で多重実行を防ぎ、production / test 双方を policy に従って削除し、**削除後に再 scan して残っていれば成功扱いにしません**（`status: failed`）。`responses` のヘッダー行は残し、ヘッダーが schema と一致しないシートは削除しません。
4. **manual_required の確認**: 結果の `manual_required_pending` を Owner が手動で処理し、処理し終えた storage ID ごとに「手動削除の完了を記録」。全件記録されるまで `status` は `completed` にならず、`completed_manual_required_pending` のままです。
5. cleanup audit（Script Property `CLEANUP_AUDIT`。直近 5 件・8,000 文字まで）に残すのは `executed_at` / `policy_version` / storage 名ごとの削除件数と成否 / `manual_required` の完了状態だけで、個人情報は含みません。

### CI

既存の `baseball-uniform-survey-schema.yml` / `baseball-uniform-survey-public-gas.yml` が、`npm run build:check`（`maintenance/SurveyGenerated.gs` の generated drift を含む）と `tests/maintenance_core.test.js` / `tests/maintenance_gas.test.js` を実行します。maintenance は専用 workflow で deploy し、Public GAS の bundle・Script ID・Environment・Secret は共有しません。PR は build / test / bundle dry-run のみ、本番は `workflow_dispatch` + Environment 承認の明示操作です。

## 多言語対応（Issue #398）

回答者向け Frontend を ja / en / ko / zh-Hans / zh-Hant の5言語に対応しました。Admin は日本語のままです。公開結果ページも同じ5言語に対応しています（Issue #414。下記「公開結果ページの5言語対応」）。**表示文言だけ**を切り替え、保存・集計・分岐は変わりません。

### 構成

| ファイル | 役割 |
|---|---|
| `i18n/ja.json` | UI 文言と section 見出し。**日本語の設問・選択肢・scale・milestone は `survey.schema.json` が正本**で、ja.json は持たない（上書き不可） |
| `i18n/{en,ko,zh-Hans,zh-Hant}.json` | `ui` / `sections` / `schemaText`（milestone・低関心メッセージ・短縮 route 案内）/ `questions`（question.id → label・helpText・anchors・notApplicable・options（option.id → label）） |
| `tools/i18n.js` | 辞書の読み込み・完全性検証・生成物の描画 |
| `baseball/baseball-uniform-survey/i18n.generated.js` | **生成物（直接編集禁止）**。`npm run build` で `i18n/*.json` から生成し、`build:check` が差分を検出。Frontend 専用で、Public/Admin/maintenance GAS には含まれない |

- 翻訳は question.id / option.id をキーに対応付けます。翻訳側に**新しい設問・選択肢・意味は作れません**（辞書にあって schema に無い key は CI で失敗）。option 数・ID・分岐条件は schema のままです。
- `single_dynamic`（`top_uniform` / `main_barrier`）は選択肢を持たず、source 設問（`favorite_uniforms` / `barriers`）の翻訳を使います。
- 中国語は `zh-Hans` と `zh-Hant` を別辞書で管理します（`zh` にまとめない）。
- `residence_country`（海外選択時の国・地域名。1行・必須）の label / helpText も5言語。入力された国・地域名は翻訳せず原文のまま保存し、公開結果・GA4 には出しません（Admin は日本語 UI で原文を確認）。
- 固有名詞「名古屋野球ユニ部」は、別団体名に見えないよう原表記を併記します（例: `Nagoya Baseball Uniform Club (名古屋野球ユニ部)`）。訳語は `tests/i18n.test.js` の用語検査（団体名・キャッチボール会・ユニフォーム交流）で固定します。
- 辞書を変更したら `npm run build`（検証に失敗すると生成しません）→ `npm test`。

### 言語選択・初期言語

- ページ上部の言語選択（日本語 / English / 한국어 / 简体中文 / 繁體中文）。回答中いつでも切り替えられ、回答値・ページ位置・route・「その他」本文・自由記述・検証エラーを保ったまま表示だけを描き直します。
- 初期言語: ① localStorage に保存済みの選択 → ② browser 言語（`ja*`→ja / `en*`→en / `ko*`→ko / `zh-CN`・`zh-SG`・`zh-Hans*`・`zh`→zh-Hans / `zh-TW`・`zh-HK`・`zh-MO`・`zh-Hant*`→zh-Hant）→ ③ ja。自動判定は保存せず、選んだときだけ保存します。
- localStorage key は `snb_baseball_uniform_survey_locale_v1`（言語コードだけ）。使えない環境ではメモリのみで動作します。URL query/fragment には言語を載せません。
- `<html lang>` と `<title>` を選択言語に合わせて更新します。

### 保存・集計は変わらない

- 保存値は stable ID のみ（`question.id` / `option.id` / scale は文字列の数値と `cannot_rate`）。言語別の schema・アンケート・Spreadsheet は作りません。
- 自由記述（`feedback` / `support_message` / 「その他」本文）は**翻訳せず入力原文**を保存・表示します。
- **`response_locale` は保存しません。** 検討結果: ① 言語別の分析が必要になる根拠が現時点で無い、② 保存すると responses の列が増え、header 完全一致で書き込みを拒否する既存 Spreadsheet（#390 で構築済み）と衝突する、③ 少数言語の回答者が個票で目立ち再識別リスクを上げる。Public GAS は言語・locale 系 key を `unknown_field` で拒否します（テスト固定）。必要になった場合は別 Issue で allowlist（5言語）検証・public snapshot へ出さない・GA4 へ送らない前提で追加します。
- GA4 へは従来どおり `form_start` / `form_error`（error type のみ）/ `survey_submit` だけ。言語・設問ID・route・回答は送りません。test mode では従来どおり GA4 を初期化しません。

### fallback と CI

- 実行時: 翻訳が欠けても画面を壊さず、選択言語 → ja（schema）の順で表示します。**これは事故時の安全策で、翻訳漏れを許容するものではありません。**
- CI（`npm test`）: `tests/i18n.test.js` が 5言語の存在、全 question.id の label、全 option.id の label と option ID 集合の完全一致、helpText・anchors・section・milestone・UI 共通文言の全言語分、unknown key / typo key / 空文字 / placeholder 欠け / 日本語の翻訳漏れ、簡体・繁体の混在、Frontend が参照する ui key と辞書の過不足を検査し、1 件でもあれば失敗します。`tests/frontend_i18n.test.js`（初期言語・切替・保持・test mode・GA4・a11y）、`tests/public_i18n.test.js`（server は stable ID のみ受理）も同様です。
- 実 Google での確認は `LAUNCH_READINESS.md` の 3A。


### 公開結果ページの5言語対応（Issue #414）

結果ページ（`baseball-uniform-survey-results.html`）も ja / en / ko / zh-Hans / zh-Hant に対応しています。**表示文言だけ**を切り替え、snapshot の値・公開状態（published のみ表示）・件数・割合・small-cell suppression・公開閾値は変わりません。

| 項目 | 内容 |
|---|---|
| 翻訳の正本 | 回答ページと同じ `i18n/*.json`。設問・選択肢は `question.id` / option ID（結果の `cell.id`）で引くため、結果ページ側で二重管理しません。`single_dynamic`（`top_uniform` / `main_barrier`）は source 設問の option を、scale は `anchors` / `notApplicable` を使います |
| 結果ページ専用の文言 | `i18n/*.json` の `ui` に `results.` 接頭辞で置きます（見出し・CTA・見方・回答数・対象者数・非表示注記・エラー・地域ブロック名・その他の地域）。「本文へ移動」「戻る」eyebrow「言語」は回答ページと同じ key を再利用します |
| 生成物 | `baseball/baseball-uniform-survey-results/results-i18n.generated.js`（**直接編集禁止**）。`npm run build` で `i18n/*.json` から結果ページが使う分だけを生成し、`build:check` が差分を検出します。`results.*` は回答ページの `i18n.generated.js` には含めません |
| 言語選択 | `baseball/baseball-uniform-survey/locale.js` を回答ページと共有します。localStorage キー `snb_baseball_uniform_survey_locale_v1`、初期言語は「保存済みの選択 → ブラウザ言語 → ja」。URL（query / hash）・GA4 には言語を載せません。相互リンクでも言語が維持されます |
| fallback | 翻訳が欠けた設問・選択肢・地域名は snapshot の日本語 label、固定 UI は ja へ。辞書自体が読めなくても描画は壊れません（欠落は CI が失敗させます） |
| SEO / OGP | canonical・og:url・OGP 画像は言語で変えません。`<html lang>`・`<title>`・`description` だけ現在の言語に合わせます |
| テスト | `tests/results_i18n.test.js`（5言語の固定 UI と設問/選択肢、state・件数・割合・suppression の不変、翻訳欠落 fallback、URL に locale が付かないこと、回答ページとの相互遷移、モバイル幅の静的検査） |

## 本番前統合・実 Google 環境 E2E（Issue #390）

Public / Admin / maintenance を別 Apps Script project として用意し、`submit_excluded` だけで実環境を確認する手順・Admin / maintenance の deploy 方式（bootstrap のみ手動）・launch go/no-go は [`LAUNCH_READINESS.md`](LAUNCH_READINESS.md) にまとめています。production は Owner の明示判断（受付期間・retention・notification・launch 実行）まで fail closed のままです。

## 検証とテスト

Node.js 22 以上。依存は jsdom（devDependency。Frontend テスト用）だけです。`npm ci` で導入します。

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

`tests/public_submit.test.js` は Public GAS の unit/integration test（Apps Script API は最小フェイク。valid submit・hidden/unknown/stale/invalid option 拒否・18歳未満・hash namespace と canonical 入力・duplicate・concurrent・source_channel・最短回答時間・受付期間・test token・notification・Formula Injection）、`tests/public_build.test.js` は生成物の整合、`tests/frontend.test.js` は Frontend（jsdom。schema 駆動の描画・各 question type・route・低関心 route・進捗・status API 各状態・submit 結果・test mode・token 非漏洩・GA4 許可イベント・analytics.js opt-out と他ページ回帰・a11y・レイアウトの静的検査・Public GAS との payload 整合）、`tests/deploy.test.js` は配備構成と workflow の検査です。

`tests/aggregate.test.js` は Admin 集計と public snapshot の unit test（production/test/invalid の分離・`question_reached`・`minTotal / minTarget / minCell`・sensitive `minTarget 20`・small-cell と complementary suppression・snapshot から小セルを逆算できないこと（総当たりで、公開出力と整合する元の件数をすべて列挙して検証。`minCell=3` で 2・2 の回帰を含む）・ordinal / nominal の並び・zero cell・地域・自由記述/hash/詳細地域の非公開・`publicResultsOrder`・semantic code の重複排除・batch 更新判定）、`tests/admin_gas.test.js` は Admin GAS（read-only・scope・generated drift・自由記述の分離・ヘッダー不一致）、`tests/results_page.test.js` は公開結果ページ（jsdom。snapshot だけを読むこと・2 層・件数表示・sensitive 未達の説明・Frontend の結果リンク）です。入力はすべて架空の fixture（`tests/helpers/fixtures.js`）で、実回答・本番 Spreadsheet には接続しません。

`tests/maintenance_core.test.js` は maintenance の判断ロジック（finalize の precondition・#382 との一致・保存順と marker・idempotent / conflict・retention 設定の fail closed・cleanup の dry-run / confirmation / 再 scan / audit / manual_required）、`tests/maintenance_gas.test.js` は maintenance GAS（fake Spreadsheet 越しの finalize / cleanup・scope・generated drift・責務分離・secret / raw data scan・CI）の検査です。

`tests/schema.test.js` は実 schema に対する検査と v2.17 の回帰（低関心 route の 3 参照、`activity_stopped_reasons`、`adult_context`、`exercise_*`）、
`tests/validator.test.js` は validator が壊れた schema を検出することの負例テストです。

CI: `.github/workflows/baseball-uniform-survey-schema.yml`（schema の参照整合）と `.github/workflows/baseball-uniform-survey-public-gas.yml`（Public GAS。#382 の Admin / snapshot / 結果ページのテストも実行）が PR ごとに上記を実行します（PR では deploy・secret は使わず、実回答・本番 Spreadsheet にも接続しません）。

## 公開 repo 上の注意

GitHub Pages は repository 全体を公開対象にします。このディレクトリには次を置きません。

- 実回答、CSV、Spreadsheet export、個票、free text dump、実データの test fixture
- salt / token / secret（server-side の Script Properties 等にのみ置く）

テストの入力は schema をメモリ上で書き換えた架空データだけです。
