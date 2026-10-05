# 男性の衣装・ポートレート意識調査（Issue #334）

「ユニ・スーツ・衣装で、撮られたい？撮りたい？」— 男性の衣装・ポートレート撮影に関する匿名アンケートの
Frontend / Public GAS / Admin GAS / テスト / デプロイ一式。

**GAS・Spreadsheet・schema・workflow はすべて本調査専用の新規作成**で、既存 fetish 用
（`nagoya_fetish_survey_webapp` / `nagoya_fetish_survey_admin`、`snb-survey-*` workflow・script）には
一切手を入れていない。UUID→SHA-256+salt、LockService内の重複判定、finalize snapshot、公開結果allowlist、
Public/Admin分離、clasp更新という**設計パターンだけ**を踏襲している。

```
GitHub Pages (community/costume-portrait-survey.html)
        │ GET ?action=status / POST text/plain
        ▼
Public GAS  ───────────►  本調査専用 Spreadsheet  ◄───────────  Admin GAS（デプロイ者権限で読み取り専用・ID token検証）
 (public/)                (responses / meta)                      (admin/)  ▲
                                                                             │ POST text/plain { idToken, action }
GitHub Pages (community/costume-portrait-survey-admin.html) ─ Googleログイン(GIS) → ID token ─┘
```

## ディレクトリ

| パス | 内容 |
|---|---|
| `survey.schema.json` | **設問定義の唯一の正本**（schema_version / question・option stable ID / label / type / required / branching / maxLength / public・private / funnel / クロス集計 / 公開結果allowlist） |
| `src/survey-core.js` | schema駆動の共通エンジン（検証・分岐・保存形式・集計・ファネル）。設問をベタ書きしない |
| `tools/build-survey.js` | schema + core から3つの生成物を作る。`--check` で差分を検出（CI） |
| `public/` | Public GAS（`SurveyGenerated.gs` は生成物） |
| `admin/` | Admin GAS = JSON API（`IdToken.gs` ID token検証 / `Auth.gs` ロール判定 / `Main.gs` doPost。`SurveyGenerated.gs` は生成物） |
| `../../costume-portrait-survey-admin.html` / `../../costume-portrait-survey-admin/` | 管理ダッシュボードUI（GitHub Pages。Googleログイン・描画。`config.js` に接続先とClient ID） |
| `../../costume-portrait-survey/` | Frontend（`survey.generated.js` は生成物、`app.js`、`results.js`、`config.js`、`style.css`） |
| `../../costume-portrait-survey.html` / `-results.html` | 回答ページ / 公開結果ページ |
| `tests/` | `npm test`（schema・core・Public・Admin・Frontend・workflow） |
| `../../../scripts/costume-portrait-survey/` | `prepare-gas.js` / `deploy-gas.sh` / clasp（lockfile固定） |
| `../../../.github/workflows/costume-portrait-{public,admin}-gas.yml` | PR検証 + 手動dispatchデプロイ |

### 生成物（Frontend / Public / Admin）

```
cd community/gas/costume_portrait_survey
npm ci
npm run build        # survey.schema.json / src/survey-core.js を変更したら必ず実行してコミット
npm run build:check  # CIと同じ差分検査
```

生成物（`SurveyGenerated.gs` ×2、`survey.generated.js`）を**直接編集しない**。設問・選択肢・分岐・ファネル・
クロス集計・公開allowlistを変えるときは `survey.schema.json` だけを変更する。

## schema

- `schema_version`：Frontend/Publicが一致しなければ `schema_mismatch`。設問構造を変えたら上げる。
- 保存キーは stable ID（例 `uniform_baseball`）。表示 `label` は保存しない（label変更の影響を受けない）。
  IDは `[a-z0-9_]` のみ（`|` を含めない）。
- `type`: `single` / `multi` / `matrix`（Q27。行ごとに1列）/ `text`。
- `showIf`: `{question, includes}` / `{question, in:[…]}`。親が非表示なら子も非表示。`sections[].showIf` も同様。
- 「その他」は `other: true` の選択肢。選択した場合のみ自由記述が必須（最大 `limits.otherMaxLength`）。
- `exclusive: true`（例「特にない」）は他の選択肢と同時に選べない。
- 条件付き自由記述: `type: text` に `showIf` / `required` / `maxLength` を指定できる（例 `residence_country`＝海外選択時のみ必須）。`multiline: false` で1行入力。非表示になった回答は破棄され、サーバーも `hidden_field` で拒否する。
- 居住地の細分化: `aichi_area`（愛知県選択時のみ必須）・`residence_country` は `visibility: private`。公開結果へは出さず、Adminで確認する（自由記述はAdminの自由記述一覧、地域は基本情報の集計）。
- schema_version 2: 曜日/時間帯の分離に伴い、共通の `time_slots` を平日用 `weekday_time_slots`（Q13で「平日」選択時のみ必須）と土日祝用 `holiday_time_slots`（土/日/祝のいずれか選択時のみ必須）へ置き換え、`aichi_area`・`residence_country` を追加（`responses` は `time_slots` 列が2列に、さらに2列増）。回答済みの旧ヘッダーのシートは保存を拒否する（`setupSpreadsheet()` も既存回答入りシートは変更しない）ため、公開前にシートを作り直してから `setupSpreadsheet()` を実行する。
- schema_version 3: 衣装カテゴリを拡張。トップカテゴリ `school_uniform`（学生服・学校制服）を追加し、`workwear` の表示名を「職業制服・作業服」へ変更（IDは維持）。`uniform`（スポーツ・部活ユニフォーム）/ `suit` / `workwear` のIDは変更しない。枝設問を追加（Q5-3/Q6-A-3/Q6-B-3/Q7-3＝`suit_*`、Q5-4/Q6-A-4/Q6-B-4/Q7-4＝`school_uniform_*`。親でそのカテゴリを選んだ時のみ表示・必須、`priorityFrom` も同様）。`uniform_detail` の `uniform_school_jersey` は `school_uniform_detail.school_jersey` へ移し、`workwear_detail` に `security` / `railway` / `aviation` / `medical_whitecoat` / `factory_workwear` を追加。Q9直後に非公開の `fetish_presentation`（Q9-A）を追加。Q5-3/Q5-4（`suit_interest` / `school_uniform_interest`）は既存Q5-1/Q5-2と同じく公開allowlist対象、Q6-A/Q6-B/Q7の枝と `fetish_presentation` は非公開。Adminはクロス集計を3種追加（撮られたい意向 × スーツ/学生服/見せ方）。`survey_version` は調査回（`2026-10`）なので据え置く。回答済みの旧ヘッダーのシートは保存を拒否するため、公開前にシートを作り直してから `setupSpreadsheet()` を実行する。
- `priorityFrom`: Q6-A/Q6-B/Q7でQ5の選択を上位表示する（未選択の衣装も「ほかの候補も選ぶ」から選べる）。
- `funnels` / `funnelFlows`: ファネル判定式。Admin集計・テストが同じ定義を使う（コードにベタ書きしない）。
- `crosstabs`: Adminの固定クロス集計17種。`publicResults`: 公開allowlist（項目・年代の粗い区分・閾値30/3）。

画面順は Issue のとおり：衣装（Q5→Q6-A→Q6-B→Q7）→撮られること→用途→背景→時間/曜日→枚数/仕上げ→不安→価格
→人物撮影→（対象者のみ）スタジオ/機材→3か月意向→**基本情報（後半）**→自由回答。冒頭に「18歳以上です」。

## Spreadsheet 保存形式（`responses` シート）

`timestamp, survey_version, schema_version, respondent_hash, completion_status, age_confirmed, <各設問の列…>, other_texts, client_elapsed_ms, notification_status`

- 単一選択: stable ID。複数選択: `|baseball|soccer|school_jersey|`（永続化形式のみ。内部処理は配列）。
- Q27(matrix): `intent_3m__get_portrait` のように行ごとの列。
- 「その他」: `other_texts` 列にJSON（`{"costume_interest":"…"}`）。選択値に文字列連結しない。
- Q28/Q29/Q30: `free_ideas` / `free_themes` / `cheer_message` 列。
- 自由記述（と `other_texts`）は `= + - @ \t \r` で始まると先頭に `'` を付けて保存（数式インジェクション対策）。Adminは表示時に戻す。
- `meta` シート（key/value）: `duplicate_rejects`（重複拒否件数）と、finalize時の `finalize_*` / `finalized_at`。
- `responses` に手で列・数式・行を追加しない（ヘッダーがschemaと一致しないと保存を拒否する）。
- UUID生値は保存しない。`respondent_hash` のみ。

## 重複回答防止・status API

```
browser UUID (localStorage) → status / submit で送信
 → GAS: SHA-256( survey_id ␊ uuid(lowercase) ␊ RESPONDENT_SALT ) = respondent_hash
 → LockService.getScriptLock() 内で「重複判定 + append」を一体で実行
```

- saltは Script Property `RESPONDENT_SALT`（`setupScriptProperties()` が生成。既存値は上書きしない。未設定/16文字未満は **fail closed**）。
- `survey_id` をhashに含めるため、同じブラウザから別アンケートへ回答できる。
- `GET ?action=status&uuid=…` → `{ok, status:"open|closed", answered, schema_version, survey_version}`。hashは返さない。
  照会できるのは自分のUUIDについてだけ（UUIDを知らない第三者が回答有無を探索する手段は無い）。
- 重複: 新規行を保存せず `duplicate_submission`。Frontendは**失敗ではなく「回答はすでに受付済みです」**と表示する
  （保存後に応答だけ失われた再送もこの経路）。
- 締切直前の再送で `survey_closed` が返った場合、Frontendはstatusを再確認し、回答済みなら「受付済み」を表示する。

### submit API（POST, `Content-Type: text/plain`, body=JSON）

```json
{ "schema_version":"1", "uuid":"…", "age_confirmed":true,
  "answers":{"costume_interest":["uniform","other"]}, "other_texts":{"costume_interest":"…"},
  "website":"", "elapsed_ms":123456 }
```

応答: `{ok:true,status:"accepted"}` / `{ok:false,error}`。`error` は
`survey_closed` / `schema_mismatch` / `invalid_request`（`fields:[{field,code}]`、値は返さない）/ `duplicate_submission` / `server_error`。

サーバー検証：`age_confirmed === true`（false/未指定/不正型は拒否）・必須・enum・複数選択の許可値/重複/排他・
条件付き必須（非表示設問の回答は拒否）・「その他」自由記述の要否・maxLength（コードポイント数）・制御文字・
UUID形式・schema_version・**未知field（top-level / answers / other_texts / matrix行）の拒否**・payloadサイズ（100KB）・
締切・malformed JSON。スパム対策は honeypot（`website`）・最短回答時間（`elapsed_ms`≥20秒）・サイズ制限のみ
（reCAPTCHA・fingerprintingは非対象）。
最短回答時間は通常回答では常に適用する。免除されるのは `test_mode:true` かつ `LIVE_TEST_ENABLED=true` のE2E実送信テスト（`?test=submit`）だけで、`LIVE_TEST_ENABLED` が無効な `test_mode` は `test_mode:disabled` で拒否する。test行は `completion_status=test` で保存され、重複判定・公開集計・Admin集計・finalizeには含めない。

### 締切

`SURVEY_CLOSES_AT`（Script Property、タイムゾーン付きISO 8601。例 `2026-11-15T23:59:59+09:00`）。
**未設定・不正値・parse不能・存在しない日付・タイムゾーン無しはすべて締切扱い（fail closed）**。
**締切時刻ちょうどは受付中、1ms後から締切**。Frontendは締切を持たず、status APIの結果だけを使う。

## Q30 メール通知

- 通常回答では送らない。Q30のtrim後に文字がある時だけ、1通（text/plain、件名固定
  `【衣装・ポートレート意識調査】応援メッセージが届きました`、本文は回答日時とQ30本文のみ。他の回答は載せない）。
- 宛先は Script Property `NOTIFICATION_EMAIL`。**回答保存の成功後**に送信し、`MailApp` の失敗・宛先未設定でも
  回答は成功扱い（`notification_failed` をログ、`notification_status` 列に `failed`）。
- 本調査のみ Q30 本文をメールに載せる例外（Issue #334）。`appsscript.json` に `script.send_mail` scope を追加済み。

## 公開結果（allowlist）と finalize

- `GET ?action=results` は**締切後に finalize したスナップショットだけ**を返す（ライブ集計・Spreadsheet参照なし）。
- allowlist方式：`schema.publicResults.items` に列挙され、かつ設問が `visibility:"public"` の項目だけを一から組み立てる。
  UUID/hash・timestamp・個票・自由記述・Q30・価格・3か月意向・居住地域・性的指向は構造上出力されない。
  公開前に `assertPublicPayload_` が key/項目を再検査し、1つでも許可外なら公開を止める。
- 有効回答 **30件未満は件数も含め非公開**（`insufficient`）。30件以上でも **カテゴリ別count < 3 は非公開**（0含む）。
  単一選択で1カテゴリだけ伏せると逆算できるため、次に小さい公開値も伏せる（二次秘匿）。年代は4区分+「回答しない・その他」。
- `finalizeSurvey()`（Apps Scriptエディタから**締切後に1回**手動実行）：
  `responseRows / validRows / lateRows / unparseableRows / publicTotal / finalizedAt / status:"final"` を算出し、公開payloadを
  Script Propertiesへチャンク保存（読み戻し検証後に確定マーカー）。以後Spreadsheetを書き換えても公開値は変わらない。
  二重実行は何も書き換えず確定済み統計を返す。途中失敗時はスナップショットを残さない。
  **締切前、締切時刻ちょうど（受付中）、および `SURVEY_CLOSES_AT` が未設定・不正値・存在しない日付の場合は確定を拒否**（`survey_not_closed` / `survey_close_not_configured`）。設定不正のまま確定して「有効回答0件」の誤った結果を固定しないため、締切値そのものを先に検証する。統計は `meta` シートにも書く。
- **Issueとの差**: Issue §9は「Admin GASがfinalize」と読めるが、既存方式（finalizeはPublic側のScript Propertiesへ固定）を踏襲し、
  AdminはSpreadsheetを**読み取り専用**に保つため、finalize実行はPublic GAS、Adminは `meta` シートから確定状態を**表示**する。

## Admin（管理ダッシュボード）: 個人Gmailで OWNER / VIEWER を分離する（Issue #354）

### 方式

```
ブラウザ（GitHub Pages: 固定origin https://nagoya-base.github.io）
  1. Google Identity Services で Googleログイン（個人Gmail可）→ Google が署名した ID token を取得
  2. fetch POST (Content-Type: text/plain) { "action": "dashboard", "idToken": "…" } → Admin GAS /exec
Admin GAS（executeAs=USER_DEPLOYING）
  3. ID token の署名・iss・aud・exp・email_verified をサーバーで検証（毎リクエスト）
  4. 検証済み email を ADMIN_OWNER_EMAILS / ADMIN_VIEWER_EMAILS と照合 → owner / viewer / forbidden
  5. ロール別に別個のレスポンスを組み立てて返す（Spreadsheetはデプロイ者権限で読む）
```

- **なぜこの方式か**: `Session.getActiveUser().getEmail()` は `USER_DEPLOYING` の Web App では「デプロイ者本人と同一 Workspace ドメイン」以外で取得が保証されず、
  個人Gmail同士では成立しない（PR #352 の方式の限界）。`USER_ACCESSING` にすると VIEWER に Spreadsheet の閲覧権限が必要になり、生データを直接開けてしまう。
  そこで **本人確認を Google が署名した ID token に一本化**し、Spreadsheet はデプロイ者権限のまま、VIEWER へは共有しない。
- **なぜ UI を GitHub Pages に置くか**: Google Identity Services は「Authorized JavaScript origins」に登録した**固定の origin** でしか動かない（ワイルドカード不可）。
  Apps Script の HTML Service は sandbox iframe で配信され、origin を固定で登録できる根拠を確認できなかったため使わない。GitHub Pages の origin は固定で、既に Public GAS への `fetch` でも使っている。
- 本人確認の根拠は **Googleが署名したtokenのみ**。クライアントが送る email / role は存在せず、送られても使わない（テストで担保）。

### CORS / Web App 設定

| 項目 | 値 | 理由 |
|---|---|---|
| `executeAs` | `USER_DEPLOYING` | Spreadsheet をデプロイ者権限で読む。VIEWER に Spreadsheet を共有しない。 |
| `access` | `ANYONE_ANONYMOUS`（全員） | ブラウザの `fetch` は Google の Cookie を送れず、`ANYONE`（要ログイン）にすると accounts.google.com へのリダイレクトで失敗する。**到達できることとデータを返すことは別**: トークン検証を通らなければデータは1バイトも返らない（fail closed）。`doGet` もデータを返さない。 |
| リクエスト | `POST` + `Content-Type: text/plain;charset=utf-8` | 「単純リクエスト」なのでCORSプリフライト（OPTIONS）が発生しない。GAS は OPTIONS に応答できず、CORSヘッダも設定できないため、この形が前提。Public GAS の回答送信（`app.js`）と同じ実績ある方式。 |
| `credentials` | `omit` | Cookie・Googleセッションを一切使わない（認証はbody内のtokenのみ → CSRFの余地なし）。 |

- tokenは **URLのquery・Header・Cookie・Storage には載せない**（POST body のみ）。
- 認可はサーバー側のみ。CI（`prepare-gas.js` / workflow）は `access=ANYONE_ANONYMOUS` かつ `executeAs=USER_DEPLOYING` を必須とし、それ以外はデプロイしない。

### API（doPost）

リクエスト body（JSON）→ レスポンス:

| action | 追加フィールド | 成功 | 備考 |
|---|---|---|---|
| `dashboard` | なし | `{ ok:true, role, data }` | OWNER: 全データ / VIEWER: allowlist のみ |
| `crosstab` | `rowKey`, `colKey` | `{ ok:true, data }` | VIEWER は許可済みの組み合わせのみ |

エラーは `{ ok:false, error }` で `error` は `unauthenticated`（token不正・期限切れ → 再ログイン）/ `forbidden`（未登録・VIEWERの禁止集計）/ `bad_request` / `server_error` のみ。詳細・例外内容は返さない。
**すべてのAPIで毎回** token を検証する（最初の1回だけ認証して以降が無認証、にはならない）。

### ID token の検証方式

tokeninfo endpoint は公式が debugging 向けとしているため使わず、**Googleの公開鍵（JWKS）でRS256署名をApps Script内で検証**する（`admin/IdToken.gs`）。payloadをbase64デコードしただけでは信用しない。

1. 形式（3セグメント・長さ上限4096・base64url）
2. header: `alg=RS256` かつ `kid` あり（`none` / HS256 等は拒否）
3. `https://www.googleapis.com/oauth2/v3/certs` の公開鍵（`CacheService` に1時間キャッシュ。未知 `kid` での再取得は60秒に1回まで）で **RSASSA-PKCS1-v1_5 / SHA-256 署名を検証**（BigInt）
4. 署名検証後に claim を検証: `iss` が `accounts.google.com` / `https://accounts.google.com`、`aud` が `ADMIN_GOOGLE_CLIENT_ID` と完全一致、`exp` 未経過、`iat` が未来でない（許容5分）、`sub` あり、`email` あり、`email_verified === true`
5. email を trim + lowercase して allowlist と照合。`sub` は検証済み identity に含めるが保存・ログ出力しない

どの失敗も `unauthenticated`（fail closed）。公開鍵が取得できない場合も拒否。単体テストでは偽IdP（実行時にメモリ上で生成したRSA鍵）で本物のRS256署名を作ってこの検証コードを通すため、**実tokenや秘密鍵はリポジトリにない**。

### 権限（OWNER / VIEWER）

| | OWNER | VIEWER |
|---|---|---|
| 総回答数・有効回答数 | ○ | ○ |
| 締切後/日時不明/重複拒否件数・finalize状態・schema情報（内部メタ） | ○ | ×（返さない） |
| 日別件数 | ○ | ○ |
| 単純集計 | 全設問（private・センシティブ含む） | `VIEWER_ALLOWED_QUESTION_IDS` の設問のみ |
| クロス集計 | 17種 + 任意の2設問 | `VIEWER_ALLOWED_CROSSTAB_IDS` の許可済み組み合わせのみ（任意軸は不可） |
| ファネル | ○ | ×（返さない） |
| 自由記述（「その他」・`free_ideas` / `free_themes` / `cheer_message`・`residence_country`） | ○ | ×（返さない） |

- **VIEWERは「DOMで隠す」のではなく、GAS側（`getViewerDashboardData_()`）でレスポンスを別に組み立てる。** 自由記述・センシティブ生データ・内部メタはJSONに含まれない。UIは返ってきたデータだけを描画し、返却されなかったタブはDOMごと作らない。
- VIEWER allowlist は `admin/Aggregate.gs` に明示定義（`survey.schema.json` の `visibility` とは独立）。設問を増やす場合は allowlist へ明示的に追加する。
- finalize は従来どおり Public GAS で実行（Adminは `meta` からの状態表示のみ。OWNERのみ）。
- 判定順: `ADMIN_OWNER_EMAILS` → `ADMIN_VIEWER_EMAILS` → forbidden。**両方にあれば OWNER 優先**。比較は trim + lowercase。未設定・空・未登録は forbidden。旧 `ADMIN_ALLOWED_EMAILS` は使わない。

### Script Properties（Admin GAS）

| Key | 内容 |
|---|---|
| `SPREADSHEET_ID` | 同じSpreadsheet |
| `ADMIN_GOOGLE_CLIENT_ID` | Google Cloud の OAuth クライアントID（Webアプリケーション）。ID token の `aud` と照合する。秘密情報ではないが環境差し替えのためProperty管理（未設定なら全拒否） |
| `ADMIN_OWNER_EMAILS` | OWNERのGmail等（カンマ区切り） |
| `ADMIN_VIEWER_EMAILS` | VIEWERのGmail等（カンマ区切り。未設定でもよい） |
| `SURVEY_CLOSES_AT` | Publicと同じ値（任意） |

### OAuth クライアントID の作り方（Google Cloud Console。手動）

1. 管理用のGoogle Cloudプロジェクトを用意（Public/Admin GASとは独立でよい。課金不要）。
2. 「Google Auth Platform → ブランディング/対象」: ユーザーの種類=**外部**、アプリ名・サポートメールを設定。スコープは追加しない（Googleログインの基本情報のみ）。
   公開ステータスが「テスト」の間は、OWNER/VIEWER の Gmail を**テストユーザー**に追加する（テストユーザー以外はログインできない場合がある。運用が安定したら「本番」へ）。
3. 「クライアント → クライアントを作成」: アプリケーションの種類=**ウェブ アプリケーション**。
   - **承認済みの JavaScript 生成元**: `https://nagoya-base.github.io`（スキーム+ホストのみ。パス・末尾スラッシュ・ワイルドカード不可）。ローカル確認が必要なら `http://localhost` と `http://localhost:<port>` を追加。
   - **承認済みのリダイレクトURI**: **不要（空でよい）**。Googleログインボタン（GIS・ID token方式）はポップアップで `credential` を直接返し、リダイレクトを使わない。
   - クライアントシークレットは**使わない**（発行されても不要。コミット・Propertyへの登録禁止）。access token / refresh token も使わない。
4. 発行された Client ID を Admin GAS の `ADMIN_GOOGLE_CLIENT_ID` に設定し、同じ値を `community/costume-portrait-survey-admin/config.js` の `googleClientId` に設定する。

### 画面（GitHub Pages）

- URL: `https://nagoya-base.github.io/snb-community/community/costume-portrait-survey-admin.html`（`noindex`・sitemap/導線なし・GA4なし）。
- `config.js` の `endpoint`（Admin `/exec` URL）と `googleClientId` が空の間は「未設定」を表示し、ログインも通信もしない。
- 未認証: Googleログインボタンのみ。成功: ダッシュボードと「管理者権限: OWNER / VIEWER」を表示。未登録: 「このアカウントには管理画面の利用権限がありません」。token期限切れ: 再ログインを促す。内部エラー・token内容は出さない。
- **tokenはメモリ上の変数だけ**に保持（localStorage / sessionStorage / Cookie / URL / console / Logger / Spreadsheet には出さない・保存しない）。ID tokenの有効期間は約1時間。期限が切れたらサーバーが `unauthenticated` を返し、再ログインになる。
- **ログアウト**: 画面右上の「ログアウト」で保持tokenを破棄しダッシュボードを消去してログイン画面へ戻る（Googleアカウント自体からのログアウトはしない）。
- CSPを `<meta>` で付与（`script-src` は自ページ+GISのみ、インラインscriptなし）。`connect-src` は `script.google.com` / `script.googleusercontent.com`（GASの応答リダイレクト先）。

### 本番反映の手順（人手。このPRでは行わない）

1. 上記「OAuth クライアントID の作り方」でClient IDを作成。
2. Admin GAS の Script Properties に `ADMIN_GOOGLE_CLIENT_ID` / `ADMIN_OWNER_EMAILS` / `ADMIN_VIEWER_EMAILS` を設定（`ADMIN_ALLOWED_EMAILS` は使われなくなるので、確認後に削除）。
3. main へマージ → Actions *Costume portrait survey Admin GAS* を `workflow_dispatch`（`source_sha` = main最新）→ Environment承認。
   初回は新しい scope（`script.external_request`）の**OAuth承認**がApps Scriptエディタで必要（デプロイ者が一度、エディタから任意の関数を実行して承認）。
4. **デプロイの管理で Admin Web App の設定を確認**: 「次のユーザーとして実行 = 自分」「アクセスできるユーザー = **全員**（`ANYONE_ANONYMOUS`）」。
   CIは manifest の `webapp` を更新するが、既存deploymentのアクセス設定が実際に切り替わるかは**実機で未確認**。「自分のみ」のままなら、既存deploymentの編集で全員へ変更する（`/exec` URLは維持される）。
5. `config.js` に Admin の `/exec` URL と Client ID を設定してコミット→マージ（GitHub Pagesに反映）。
6. **ロール確認**: OWNERのGmailでログイン → 「管理者権限: OWNER」で全タブ（ファネル・自由記述含む）。VIEWERのGmailでログイン → 「管理者権限: VIEWER」でファネル・自由記述タブが無いこと、任意クロス集計UIが無いこと。未登録のGmail → 権限なし表示。
   ブラウザの開発者ツール（Network）で、レスポンスに VIEWER で自由記述等が含まれないことも確認する。
7. 古い `Dashboard*.html` はCIの `clasp push` で置き換わり削除される。

### 集計の意味

- count は「その選択肢を選んだ回答者数」（延べ選択数ではない）。複数選択×複数選択のセルは
  「行・列の両方を選んだ回答者数」で、1人が複数セルに入るため合計は回答者数と一致しない。割合の分母は行の値を選んだ回答者数。
- 概要（総回答数・有効回答数・締切後/日時不明・重複拒否件数・日別・finalize状態・年代/居住地）、全設問の単純集計、
  ファネル2種、クロス集計（固定17種 + 任意の2設問）、自由記述（各「その他」・Q28・Q29・Q30）。描画は `textContent` のみ（XSS対策）。

## GA4

既存 `analytics.js` のイベントのみ：`form_start` / `section_view`（`costume_portrait_survey_<section>`）/ `form_error`
（`error_type`: validation / network / server / survey_closed / schema_mismatch / invalid_request）/ `survey_submit`（受付時のみ、
重複では送らない）。回答内容・UUID/hash・自由記述・性的指向は送らない。`generate_lead` は使わない。`?test=1` / `?test=closed` はGA4を読み込まない。

## ログ

`accepted / duplicate / invalid / closed / schema_mismatch / notification_failed / finalize / error` をJSON1行で記録。
フィールドはイベント名・エラーコード・設問ID・件数のみ（回答内容・自由記述・UUID・hash・メールアドレスは出さない）。

## テスト

```
cd community/gas/costume_portrait_survey
npm ci && npm test                 # 生成物差分 + schema/core/Public/Admin/Frontend/workflow（Node 22, jsdom）
python3 -m unittest scripts.tests.test_costume_portrait_deploy -v   # リポジトリルートで。clasp モックによるデプロイ手順の検証
```

## 初回セットアップ（すべて手動。Actionsでは自動化しない）

1. **Spreadsheet** を新規作成（既存のものは使わない）。IDを控える。
2. **Public GAS プロジェクト**を新規作成（Spreadsheet紐付け不要）。Script ID を控える。
3. **Admin GAS プロジェクト**を新規作成。Script ID を控える。
4. 各プロジェクトに初回だけコードを入れる（空のままでもCIは初期スタブ `Code.gs` を上書きできる）。
   最初のデプロイは Actions（下記）で行うのが安全。`appsscript.json` はCIが管理するため手でコピペしない。
5. **Script Properties**
   - Public: `SPREADSHEET_ID` / `SURVEY_CLOSES_AT` / `NOTIFICATION_EMAIL`（`RESPONDENT_SALT` は手順7で生成）
   - Admin: `SPREADSHEET_ID`（同じSpreadsheet） / `ADMIN_GOOGLE_CLIENT_ID` / `ADMIN_OWNER_EMAILS` / `ADMIN_VIEWER_EMAILS`（任意） / `SURVEY_CLOSES_AT`（Publicと同じ値。締切後の行の判別用、任意）。詳細は「Admin（管理ダッシュボード）」
6. **Web App deployment を各プロジェクトで1回だけ作成**し、Deployment ID と `/exec` URL を控える。
   - Public: 実行ユーザー=自分、アクセス=全員（匿名可）
   - Admin: 実行ユーザー=自分、アクセス=**全員（`ANYONE_ANONYMOUS`）**。データは doPost でGoogle ID tokenを検証するまで一切返らない（CIは `ANYONE_ANONYMOUS` + `USER_DEPLOYING` 以外ならデプロイしない）
7. Apps Scriptエディタで Public の `setupScriptProperties()`（salt生成）→ `setupSpreadsheet()`（`responses` / `meta` シートとヘッダー作成）を実行。
   このとき **OAuth承認**（Spreadsheet・`script.send_mail`）を行う。Adminは Apps Script エディタから一度関数を実行し、`spreadsheets.readonly` と `script.external_request`（Googleの公開鍵取得）を承認する。
8. **GitHub Environment を2つ新規作成**（Settings → Environments）
   - `costume-portrait-public-production` / `costume-portrait-admin-production`
   - どちらも **Deployment branches = `main` のみ** + **Required reviewers（承認者）**
   - 各Environmentの **Secrets**（Environment単位で、対象GASの値を登録）:
     `CLASPRC_JSON`（clasp認証。GitHub Secretsのみ。コミット禁止）/ `COSTUME_PORTRAIT_SCRIPT_ID` / `COSTUME_PORTRAIT_DEPLOYMENT_ID`
   - ※ Environmentの作成・保護ルール・Secret登録はコードからは行えないため手動設定が必要。
9. `community/costume-portrait-survey/config.js` の `endpoint` に Public の `/exec` URL を設定してコミット。
   管理ダッシュボードは `community/costume-portrait-survey-admin/config.js` に Admin の `/exec` URL と OAuth クライアントIDを設定してコミット（「Admin（管理ダッシュボード）」参照）。
10. 公開前に `community/costume-portrait-survey.html` の `<meta name="robots" content="noindex…">` を外し、
    必要なら `community/index.html` / `sitemap.xml` に導線を追加する（現状は未公開のため追加していない）。

## 運用

- **コード更新**: PRで検証（本番は更新されない）→ mainへマージ → Actions の *Costume portrait survey Public GAS* /
  *Admin GAS* を `workflow_dispatch`（`source_sha` = main最新commit）→ Environment承認 → `deploy-gas.sh`。
  既存deploymentを `update-deployment` するだけで、新規deploymentは作らず `/exec` URLは変わらない。
  Script Properties・`SPREADSHEET_ID` は変更しない。Public のWeb Appアクセス設定は変更しない（remoteの `webapp` を保持）。
  Admin の `webapp` はリポジトリ側（`ANYONE_ANONYMOUS` / `USER_DEPLOYING`）が正。既存の `MYSELF` 等からの移行は許可し、未知の値・書き込み/メールscopeは拒否する。
- **schemaを変えるとき**: `survey.schema.json` を編集 → `npm run build` → コミット。回答開始後に設問構造を変える場合は
  `schema_version` を上げ、`responses` のヘッダーと整合させる（ヘッダー不一致時は保存を拒否する）。
- **締切後**: Public で `finalizeSurvey()` を実行 → `?action=results` と公開結果ページで確認（30件以上のときのみ表示）。
