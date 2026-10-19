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

### Public（既存 workflow）

- GitHub Environment `baseball-uniform-survey-public-production`（main 限定・承認者あり）に Secrets `CLASPRC_JSON` / `BASEBALL_UNIFORM_SURVEY_SCRIPT_ID` / `BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID` が登録済みであること。
- production deploy は `workflow_dispatch` + main のみ。PR push では dry-run だけで secret を使わないこと（`tests/deploy.test.js` が検査）。

### Admin / maintenance（手動 deploy。workflow は新設しない）

各 project で次を守ります。

1. Apps Script で **新しい別 project** を作る（Public の project を流用しない）。
2. リポジトリの該当ディレクトリ（`admin/` または `maintenance/`）のファイルだけを貼る／push する。`appsscript.json` を含め、`oauthScopes` と `webapp` が上表どおりであることを確認する。別ディレクトリのファイルを混ぜない。
3. Web App を `executeAs: USER_DEPLOYING` / `access: MYSELF` で deploy する。
4. Script Property `RESPONSES_SPREADSHEET_ID` だけを設定する。
5. deploy 後、エディタの「プロジェクトの設定」で scope と Web App 設定が manifest と一致していることを目視確認する。

## 3. `submit_excluded` E2E

### Frontend の endpoint

- **E2E 中**: `config.js` の `endpoint` は空のままにし、ローカル override（手元の未コミット変更など）で `/exec` URL を設定する。E2E 用の endpoint 値をこのブランチ・手順書 PR へ commit しない。
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
- [ ] 新規 responses Spreadsheet
- [ ] secrets / properties 設定済み（`TEST_TOKEN` / `RESPONDENT_SALT` / Spreadsheet ID / 通知メール / clasp credentials は repo 非公開）
- [ ] **Owner が notification 有効 / 無効を明示確認**（`notification.enabled` の値は Owner 確認後に更新。それまで変更しない）
- [ ] production launch PR で `config.js` の `endpoint` に公開 Web App URL を設定
- [ ] `submit_excluded` E2E 成功
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
- 4 production fail closed: ○/×
- 5 Frontend実機（iPhone Safari / PC）: ○/×
- 6 GA4 privacy: ○/×
- 7 Admin: ○/×
- 8 maintenance: ○/×
未解決 / Owner待ち:
```
