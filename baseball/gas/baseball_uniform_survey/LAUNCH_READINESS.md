# 本番前統合・実 Google 環境 E2E・launch readiness 手順（Issue #390）

親 Issue #377。この文書は **手順とチェックリストだけ**を持ちます。次の値はここにもリポジトリにも書きません（commit 禁止）: `TEST_TOKEN`、`RESPONDENT_SALT`、Spreadsheet ID、通知メール（実メールアドレス）、clasp credentials（`CLASPRC_JSON`）、Script ID、Deployment ID。公開 Web App の `/exec` URL 自体は secret として扱いません（下記「Frontend の endpoint」）。

**この段階では production を開けません。** 実 Google 環境の確認は `submit_excluded` だけで行い、production は fail closed のままにします。

## Owner 判断待ち（実装側は決めない）

| # | 項目 | 反映先（確定後に別 PR。auto-merge 禁止） |
|---|---|---|
| 1 | `opens_at` | `survey.config.json` の `reception.opens_at` |
| 2 | `closes_at` | `survey.config.json` の `reception.closes_at` |
| 3 | retention policy / `policy_version` | `retention.config.json` |
| 4 | retention end date または `closes_at + N days` | `retention.config.json`（どちらか一方） |
| 5 | `keep_final_snapshot` | `retention.config.json` |
| 6 | cleanup operator / verification method | `retention.config.json` |
| 7 | notification 有効 / 無効 | `survey.config.json` の `notification.enabled`（現在のコード上の既定は `true`。**未判断のまま**） |

確定後は `survey.config.json` / `retention.config.json` / `survey.schema.json` の `respondentNotice.retention.status` を整合して更新し、`npm run build` の生成物も同じ PR に含めます。

## 1. project 分離

| 役割 | Apps Script project | scope | Web App | 参照する Spreadsheet |
|---|---|---|---|---|
| Public | 専用 project | `spreadsheets` / `script.send_mail` | 全員（回答受付。manifest に `webapp` は置かず、初回手動 deploy の設定を保持） | 新規 responses Spreadsheet（read/write） |
| Admin | **Public と別** project | `spreadsheets.readonly` | `USER_DEPLOYING` / `MYSELF` | 同じ responses Spreadsheet（read-only） |
| maintenance | **Public / Admin と別** project | `spreadsheets` | `USER_DEPLOYING` / `MYSELF` | 同じ responses Spreadsheet |

Script Properties（値は repo / Secrets / ログに出さない）:

| project | Property |
|---|---|
| Public | `SPREADSHEET_ID`、`RESPONDENT_SALT`（`setupScriptProperties()` が生成）、`TEST_TOKEN`（24 文字以上）、`NOTIFICATION_EMAIL`（notification を使う場合のみ） |
| Admin | `RESPONSES_SPREADSHEET_ID` |
| maintenance | `RESPONSES_SPREADSHEET_ID`（Public の salt / token / 通知先は設定しない・参照しない） |

**確定事項**: Spreadsheet ID の Script Property 名は **Public = `SPREADSHEET_ID` / Admin・maintenance = `RESPONSES_SPREADSHEET_ID`**（実装の `public/Config.gs` / `admin/Config.gs` / `maintenance/Config.gs` どおり）。Issue #390 本文の Public 側の記載（`RESPONSES_SPREADSHEET_ID`）はこの確定事項で読み替えます。コード側の rename はしません。

## 2. deploy 準備

### 方式（Public / Admin / maintenance 共通）

3 project とも、**PR は build / test / bundle dry-run のみ**、**本番 deploy は main からの `workflow_dispatch` + 専用 GitHub Environment 承認で、既存 Web App deployment を更新する**方式です。初回 bootstrap は次のとおり整理します。

1. Apps Script project の作成自体は**手動**（Public / Admin / maintenance は**必ず別 project**）
2. Public / Admin / maintenance の**最初のコード push**は、(a) 手動で行う方法、(b) 専用 bootstrap workflow `baseball-uniform-survey-bootstrap-gas.yml` を使う方法のどちらでも可。bootstrap workflow が行うのは初回の allowlist `clasp push` のみ
3. OAuth 承認は**手動**
4. Script Properties の設定は**手動**
5. 最初の Web App deployment の作成は**手動**

bootstrap 成功後は bootstrap workflow を再利用せず、通常 deploy workflow へ移行します。Public も同じ bootstrap workflow（`public` target・専用 Environment / Secret）で初回 push できます。Public の最初の Web App deployment・OAuth 承認・Script Properties は引き続き手動です。

| target | workflow | Environment | Secrets（`CLASPRC_JSON` に加えて） | bundle allowlist |
|---|---|---|---|---|
| Public | `baseball-uniform-survey-public-gas.yml` | `baseball-uniform-survey-public-production` | `BASEBALL_UNIFORM_SURVEY_SCRIPT_ID` / `BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID` | `public/` の 10 ファイル |
| Admin | `baseball-uniform-survey-admin-gas.yml` | `baseball-uniform-survey-admin-production` | `BASEBALL_UNIFORM_SURVEY_ADMIN_SCRIPT_ID` / `BASEBALL_UNIFORM_SURVEY_ADMIN_DEPLOYMENT_ID` | `admin/` の 7 ファイル |
| maintenance | `baseball-uniform-survey-maintenance-gas.yml` | `baseball-uniform-survey-maintenance-production` | `BASEBALL_UNIFORM_SURVEY_MAINTENANCE_SCRIPT_ID` / `BASEBALL_UNIFORM_SURVEY_MAINTENANCE_DEPLOYMENT_ID` | `maintenance/` の 8 ファイル |

各 Environment は main 限定・承認者ありで作り、その target 専用の Secrets だけを登録します（Script ID / Deployment ID / clasp credentials の実値はリポジトリ・Issue・ログに書かない）。

### 他 project へ push されないための仕組み

- allowlist は `scripts/baseball-uniform-survey/prepare-gas.js` の `TARGETS`。target ごとに source ディレクトリ・ファイル・OAuth scope・Script ID / Deployment ID の環境変数名が分かれており、workflow は自分の target を固定で渡します。
- push 前に `clasp pull` したリモートも同じ allowlist で検証し、別 target のファイル（例: Admin の project に `Finalize.gs`）・手書きコード・ディレクトリがあれば上書きせず拒否します。
- `deploy-gas.sh` は、他 target の Script ID / Deployment ID が環境に存在すれば clasp を呼ぶ前に拒否します。
- Admin は `spreadsheets.readonly`、maintenance は `spreadsheets` と scope が完全一致のときだけ stage します（Admin に書込み scope は入れられません）。
- Admin / maintenance は、リポジトリ側 manifest もリモートの manifest も `executeAs: USER_DEPLOYING` / `access: MYSELF` でなければ配備しません。`update-deployment` は access を変更しないため、dispatch 入力 `webapp_access_set_to_myself` を確認済みの `true` にしないと、checkout / clasp より前に失敗します。
- 上記は `tests/deploy.test.js` / `tests/deploy_isolation.test.js` が検査します（実 Google へは接続しません）。

### 初回 bootstrap（project 作成・OAuth・Script Properties・最初の deployment は手動。各 project 共通）

1. Apps Script で **新しい別 project** を作る（他の target の project を流用しない）。
2. 初回だけ、リポジトリの該当ディレクトリ（`public/` / `admin/` / `maintenance/`）のファイルだけを貼る／push し（Public / Admin / maintenance とも下記の bootstrap workflow でも可）、`appsscript.json` の `oauthScopes` と `webapp` が上表・下記どおりであることを確認する。別ディレクトリのファイルを混ぜない。
3. OAuth 承認と Script Properties の設定（Admin / maintenance は `RESPONSES_SPREADSHEET_ID` だけ。Public は README の手順）。
4. Web App の最初の deployment を作る。Admin / maintenance は `executeAs: USER_DEPLOYING` / `access: MYSELF`、Public は README のとおり。
5. Script ID / Deployment ID と clasp credentials をその target 専用の Environment Secrets に登録する。
6. エディタの「プロジェクトの設定」で scope と Web App 設定が manifest と一致していることを目視確認する。

#### Public / Admin / maintenance の最初のコード push を bootstrap workflow で行う（任意。手動 push でも可）

手順 2 の「初回 push」だけは、専用 workflow `baseball-uniform-survey-bootstrap-gas.yml`（手動 `workflow_dispatch`・main 限定）で代替できます。通常の deploy workflow とは Environment・Secret ともに分離されています。

| target | Environment（main 限定・承認者あり） | Secrets |
|---|---|---|
| Public | `baseball-uniform-survey-public-bootstrap` | `CLASPRC_JSON` / `BASEBALL_UNIFORM_SURVEY_PUBLIC_BOOTSTRAP_SCRIPT_ID` |
| Admin | `baseball-uniform-survey-admin-bootstrap` | `CLASPRC_JSON` / `BASEBALL_UNIFORM_SURVEY_ADMIN_BOOTSTRAP_SCRIPT_ID` |
| maintenance | `baseball-uniform-survey-maintenance-bootstrap` | `CLASPRC_JSON` / `BASEBALL_UNIFORM_SURVEY_MAINTENANCE_BOOTSTRAP_SCRIPT_ID` |

- 行うのは target 別 allowlist（`TARGETS[target].files` + `appsscript.json`）の `clasp push` **だけ**です。version・deployment の作成／更新、Web App のアクセス設定の変更、Script Properties の設定、関数の実行は行いません（Admin / maintenance の manifest の `webapp` はリポジトリ側の `MYSELF` / `USER_DEPLOYING` で、deployment が無いうちは公開範囲は生じません。Public の manifest は従来どおり `webapp` を持たず、OAuth scope も `spreadsheets` / `script.send_mail` のままです）。
- Deployment ID の Secret は使いません。通常 deploy 用の Secret（`*_SCRIPT_ID` / `*_DEPLOYMENT_ID`。Public の `BASEBALL_UNIFORM_SURVEY_SCRIPT_ID` / `BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID` を含む）や他 target の bootstrap Script ID が環境にあれば、clasp を呼ぶ前に拒否します。
- 空の初期 project（placeholder の `Code.gs` のみ・versioned deployment なし）にしか push しません。target のファイルが既にある、別 target の project、手書きコードがある、Public の remote manifest に `webapp` が既にある、versioned deployment がある場合は拒否するため、**bootstrap 成功後は再実行不要**（再実行しても何も変わりません）です。
- PR では build / test / bundle dry-run のみ（secret・GAS 接続なし）。auto-merge は使いません。
- 実行後の手順: OAuth 承認 → Script Properties → 最初の Web App deployment（`MYSELF`）→ 通常 deploy 用の Environment Secrets を登録 → 以降は通常 deploy workflow。

以降の更新は、main で該当 workflow を `workflow_dispatch` し、Environment 承認を経て既存 deployment を更新します（`/exec` URL は変わりません）。**このリポジトリの変更だけでは production deploy は実行されません。**

## 3. `submit_excluded` E2E

### Frontend の endpoint

- **E2E 中**: `config.js` の `endpoint` は空のままにし、ローカル override（手元の未コミット変更など）で `/exec` URL を設定する。E2E 用の endpoint 値をこのブランチ・手順書 PR へ commit しない。
- override は **ページ読み込み前**（未コミットの `config.js` 編集、または DevTools Local Overrides）に反映するのが基本。`app.js` は endpoint を使う時点（status 取得・送信）で読むため、読み込み後に設定した場合も送信できる。test mode は起動時に通信しないので、endpoint が空のまま送信すると「現在このアンケートは準備中のため、送信できません。」が出る（server の応答ではなく Frontend の endpoint 未設定）。
- `submit_excluded` は production の受付状態（`not_configured` / `not_open` / `closed`）に依存しない。E2E のために `survey.config.json` の `opens_at` / `closes_at` を仮設定しない。
- **production launch PR**: `config.js` に公開 Web App の `/exec` URL を設定する。この URL 自体は secret として扱わない（公開ページから参照される値のため）。ただし Script ID / Deployment ID 単体や clasp credentials は引き続き commit しない。


URL: `…/baseball-uniform-survey.html#test=submit_excluded&token=<TEST_TOKEN>&run=<test_run_id>`

| # | 確認 | 期待 |
|---|---|---|
| 3-1 | 遷移後のアドレスバー | fragment が消え、test 状態は維持される |
| 3-2 | 送信先 URL（DevTools Network） | token が query string に無く、POST body にのみある |
| 3-3 | 不正 token / 不正 run / 不正 mode | fail closed。回答開始不可で、production に落ちない |
| 3-4 | 同一 `test_run_id` + 同一 browser で再送 | 重複として抑止される |
| 3-5 | 別 `test_run_id` で送信 | 別 test として保存される |
| 3-6 | responses の保存形式 | `response_mode=test`、`test_run_id` あり、`respondent_hash` はハッシュ値で raw UUID はどの列にも無い |
| 3-7 | production 側 | count / Admin 標準集計 / public snapshot / 通知 / production GA4 のいずれにも入らない |

E2E で作った test row は retention 対象です。launch 前に必要なら cleanup 手順で削除します。

### 3A. 多言語（ja / en / ko / zh-Hans / zh-Hant）E2E（Issue #398）

回答 Frontend の5言語対応を、実ブラウザ（PC と iPhone Safari）＋実 Google 環境で確認します。保存値は言語によらず stable ID、自由記述は入力原文です。`submit_excluded` の test URL（上と同じ）で行い、production には送りません。

| # | 確認 | 期待 |
|---|---|---|
| 3A-1 | ja で回答開始 → 1 ページ目に回答 → `English` へ変更 | 回答・ページ位置が保持される。`<html lang>` が `en` |
| 3A-2 | en → `한국어` → `简体中文` → `繁體中文` の順に、設問に答えながら切替 | そのつど回答・route・「その他」本文・自由記述が保持され、表示だけが切り替わる |
| 3A-3 | 途中で言語を変えたまま確認画面 → 送信（`submit_excluded`） | test 完了表示が選択言語。送信成功 |
| 3A-4 | responses シート | 選択肢は全て stable ID（label・翻訳文が無い）。自由記述・「その他」は入力原文。言語を示す列が無い（`response_locale` は保存しない） |
| 3A-5 | 別言語で、同じ `test_run_id` + 同じ browser で再送 | 言語によらず重複として抑止され、重複表示が選択言語になる |
| 3A-6 | test mode（`preview_no_submit` / `closed_view` / `submit_excluded`）で言語切替 | fragment token / sessionStorage / `test_run_id` / endpoint が壊れない |
| 3A-7 | DevTools Network | test mode では GA4（`googletagmanager` / `collect`）への通信が無い。production でも言語・設問ID・route・回答を GA4 に送らない |
| 3A-8 | Admin（日本語 UI） | 5言語分の回答が、選択肢ごとに 1 つの集計セルへ集まる（言語別に分裂しない）。自由記述は原文 |
| 3A-9 | iPhone Safari / 韓国語・中国語での表示 | 言語選択が上部で操作でき、折り返し・横スクロールが無い。ラベル/入力の読み上げが選択言語 |

## 4. production fail closed

| 確認 | 期待 |
|---|---|
| `GET <exec>?action=status` | `not_configured`（受付可能状態を返さない） |
| production POST を直接送る | `survey_not_configured` 等で拒否され、保存されない |
| Frontend から誤って production 送信 | 保存されない |
| `retention.config.json` / schema の retention status | `unset` / `must_set_before_launch` のまま |

**確認のために暫定日付を入れない**（fail open になるため）。

## 5. Frontend 実機（iPhone Safari / PC）

- [ ] route 分岐
- [ ] hidden stale value が送信に残らない
- [ ] 低関心 route でも `exercise_frequency / exercise_motivation / age / region / feedback / support_message` が残る
- [ ] 進捗が route-aware で後退しない
- [ ] 18 歳未満は回答本文を送信しない
- [ ] submit の二重押し防止
- [ ] エラー表示
- [ ] 結果ページへのリンク
- [ ] test 終了操作
- [ ] test invalid 時は回答開始不可

## 6. GA4 privacy

DebugView / Network で、survey page が送るのは次だけであること。

- 許可: `form_start`、`form_error`（error type のみ）、`survey_submit`
- 禁止: section / route / question / option / answer、age / region、自由記述、respondent_hash / UUID、test token / run
- `section_view` は survey page で送らない
- test / preview 状態から production analytics へ送らない

## 7. Admin 実環境（test row のみの状態）

- [ ] production valid total に test が入らない
- [ ] test 除外件数として表示される
- [ ] read-only（編集・削除 UI / endpoint なし）
- [ ] 自由記述は別タブで明示操作したときだけ読み込まれ、通常集計と分離されている
- [ ] public preview に test / 自由記述 / hash / 詳細地域が出ない

## 8. maintenance 実環境（締切前状態）

- [ ] finalize preflight が `not_closed_yet` または未設定で fail closed
- [ ] finalize 実行不可
- [ ] retention 未確定で cleanup 実行不可
- [ ] dry-run が個票を返さない
- [ ] LockService が取得できる
- [ ] Web App が MYSELF 限定

締切後 finalize の本番相当テストは、実データに日付を捏造して行わず、完全に分離した fixture Spreadsheet / test project でのみ行います。

## 9. launch go/no-go

- [ ] Public / Admin / maintenance が別 project
- [ ] 3 target の専用 Environment（main 限定・承認者あり）と専用 Secrets（Script ID / Deployment ID / `CLASPRC_JSON`）を登録済み（bootstrap 後）
- [ ] 新規 responses Spreadsheet
- [ ] secrets / properties 設定済み（`TEST_TOKEN` / `RESPONDENT_SALT` / Spreadsheet ID / 通知メール / clasp credentials は repo 非公開）
- [ ] **Owner が notification 有効 / 無効を明示確認**（`notification.enabled` の値は Owner 確認後に更新。それまで変更しない）
- [ ] production launch PR で `config.js` の `endpoint` に公開 Web App URL を設定
- [ ] `submit_excluded` E2E 成功
- [ ] 多言語（5言語）E2E 成功（3A）
- [ ] invalid test が production へ fallback しない
- [ ] production fail closed 確認済み
- [ ] Admin read-only 確認済み
- [ ] maintenance fail closed 確認済み
- [ ] GA4 privacy 確認済み
- [ ] Owner が受付期間を確定
- [ ] Owner が retention policy / 期限を確定
- [ ] `retention.config.json` が `confirmed`
- [ ] schema の retention status を更新
- [ ] 親 #377 の Owner retention checkbox を手動更新
- [ ] CI 全成功
- [ ] production deploy は明示操作のみ

## Issue コメント用の結果テンプレート

値・ID・URL・token は書かず、結果だけを記録します。

```
### 実Google環境 E2E 結果（#390）
実施日 / 実施者:
環境: Public/Admin/maintenance 別project = ○/×、新規Spreadsheet = ○/×
- 3 submit_excluded E2E: 3-1〜3-7 = ○/×（×の内容）
- 3A 多言語 E2E: 3A-1〜3A-9 = ○/×（×の内容）
- 4 production fail closed: ○/×
- 5 Frontend実機（iPhone Safari / PC）: ○/×
- 6 GA4 privacy: ○/×
- 7 Admin: ○/×
- 8 maintenance: ○/×
未解決 / Owner待ち:
```
