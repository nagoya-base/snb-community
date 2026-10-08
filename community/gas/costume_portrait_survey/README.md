# 男性の衣装・ポートレート意識調査（Issue #334）

「ユニ・スーツ・衣装で、撮ってもらいたい？撮りたい？」— 男性の衣装・ポートレート撮影に関する匿名アンケートの
Frontend / Public GAS / Admin GAS / テスト / デプロイ一式。

**GAS・Spreadsheet・schema・workflow はすべて本調査専用の新規作成**で、既存 fetish 用
（`nagoya_fetish_survey_webapp` / `nagoya_fetish_survey_admin`、`snb-survey-*` workflow・script）には
一切手を入れていない。UUID→SHA-256+salt、LockService内の重複判定、finalize snapshot、公開結果allowlist、
Public/Admin分離、clasp更新という**設計パターンだけ**を踏襲している。

```
GitHub Pages (community/costume-portrait-survey.html)
        │ GET ?action=status / POST text/plain
        ▼
Public GAS  ───────────►  本調査専用 Spreadsheet  ◄───────────  Admin GAS（OWNER 1名専用・読み取り専用）
 (public/)                (responses / meta)                      (admin/)  ▲
                                                                             │ google.script.run
OWNER本人のブラウザ ── Admin GAS /exec（Web App access=MYSELF）→ 管理ダッシュボードHTML ─┘
```

## ディレクトリ

| パス | 内容 |
|---|---|
| `survey.schema.json` | **設問定義の唯一の正本**（schema_version / question・option stable ID / label / type / required / branching / maxLength / public・private / funnel / クロス集計 / 公開結果allowlist） |
| `src/survey-core.js` | schema駆動の共通エンジン（検証・分岐・保存形式・集計・ファネル）。設問をベタ書きしない |
| `tools/build-survey.js` | schema + core から3つの生成物を作る。`--check` で差分を検出（CI） |
| `public/` | Public GAS（`SurveyGenerated.gs` は生成物） |
| `admin/` | Admin GAS（OWNER 1名専用。`Main.gs` doGet / `Dashboard*.html` 管理画面UI / `Aggregate.gs` 集計。`SurveyGenerated.gs` は生成物） |
| `../../costume-portrait-survey-admin.html` | 旧 GitHub Pages 管理画面URL。noindex の「移行済み」案内のみ |
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
- schema_version 3: 衣装カテゴリを拡張。トップカテゴリ `school_uniform`（学生服・学校制服）を追加し、`workwear` の表示名を「職業制服・作業服」へ変更（IDは維持）。`uniform`（スポーツ・部活ユニフォーム）/ `suit` / `workwear` のIDは変更しない。枝設問を追加（Q5-3/Q6-A-3/Q6-B-3/Q7-3＝`suit_*`、Q5-4/Q6-A-4/Q6-B-4/Q7-4＝`school_uniform_*`。親でそのカテゴリを選んだ時のみ表示・必須、`priorityFrom` も同様）。`uniform_detail` の `uniform_school_jersey` は `school_uniform_detail.school_jersey` へ移し、`workwear_detail` に `security` / `railway` / `aviation` / `medical_whitecoat` / `factory_workwear` を追加。Q9直後に非公開の `fetish_presentation`（Q9-A）を追加。Q5-3/Q5-4（`suit_interest` / `school_uniform_interest`）は既存Q5-1/Q5-2と同じく公開allowlist対象、Q6-A/Q6-B/Q7の枝と `fetish_presentation` は非公開。Adminはクロス集計を3種追加（撮ってもらいたい意向 × スーツ/学生服/見せ方）。`survey_version` は調査回（`2026-10`）なので据え置く。回答済みの旧ヘッダーのシートは保存を拒否するため、公開前にシートを作り直してから `setupSpreadsheet()` を実行する。
- `priorityFrom`: Q6-A/Q6-B/Q7でQ5の選択を上位表示する（未選択の衣装も「ほかの候補も選ぶ」から選べる）。
- `funnels` / `funnelFlows`: ファネル判定式。Admin集計・テストが同じ定義を使う（コードにベタ書きしない）。
- `crosstabs`: Adminの固定クロス集計17種。`publicResults`: 公開allowlist（項目・年代の粗い区分・閾値30/3）。
- 需要ファネル（Issue #361）: Admin OWNER専用。`admin/Aggregate.gs` の `DEMAND_FUNNELS` / `DEMAND_PREDICATES` に定義（既存stable IDのみ使用。schema・設問・Spreadsheet列・Public結果は変更しない）。被写体の撮影経験・セルフ撮影/動画等の利用形態は既存データから判定できないため集計しない。

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

- `GET ?action=results`（Issue #359 / #367）：公開は2層。**基本属性**（年代・居住地方ブロック。Issue #369）は有効回答数に関わらず、
  **本集計**（`publicResults.items` の `tier:"main"`）は有効回答30件以上で追加する。
  | 状態 | 応答 `results` | 表示 |
  |---|---|---|
  | 未確定・受付中・30件未満 | `status:"partial"` + `phase:"collecting"` + `threshold_reached:false`（`items`＝基本属性のみ、`total`・`min_total:30`） | 「現在の回答傾向（基本情報）」「現在の有効回答数：XX件 / 30件」 |
  | 未確定・受付中・30件以上 | `partial` + `collecting` + `threshold_reached:true`（基本属性＋本集計） | 途中集計 |
  | 未確定・受付終了後 | `partial` + `phase:"closed_pending"`（30件未満は基本属性のみ） | 受付終了・最終確定待ち |
  | 確定済み | `final`（確定スナップショット。Spreadsheetは読まない。30件未満は `threshold_reached:false` で基本属性のみ） | 最終結果 |
  旧仕様の `status:"insufficient"` はGASからは返さない。フロントは更新前GAS向けの互換としてだけ従来の案内文を残している。
  途中集計は読み取りのみで、確定マーカー・スナップショット・metaは作らない。抽出条件は `collectValidRecords_` を finalize と共有する
  （test行・日時なし/不正・締切後の行を除外）。`SURVEY_CLOSES_AT` が未設定・不正なら途中集計は出さず `{ok:false,error:"survey_close_not_configured"}`。
  フロントは通信失敗・不正レスポンス・`ok:false` を読み込みエラーとして扱い、「30件未満」とは表示しない。
  結果ページの「アンケートに回答する」CTAは受付中（`phase:"collecting"`）と判明した時だけ表示し、`final`・受付終了後・読み込み失敗では表示しない。
  回答ページには結果ページへの「現在の結果を見る」リンクを常設する。
- allowlist方式：`schema.publicResults.items` に列挙され、かつ設問が `visibility:"public"` の項目だけを一から組み立てる。
  例外として、`tier:"basic"` かつ `Results.gs` の `BASIC_PUBLIC_QUESTIONS`（`age_range` / `residence`）に**コードで固定**した設問だけは、
  設問が `private` のままでも公開できる（schemaに足しただけでは他の設問は公開されない。denylistへは変更しない）。
  UUID/hash・timestamp・個票・自由記述・Q30・価格・3か月意向・`residence_country`・性的指向は構造上出力されない。
  公開前に `assertPublicPayload_` が key/項目を再検査し、1つでも許可外なら公開を止める（`threshold_reached:false` に基本属性以外の項目があっても止める）。
- 総回答数は30件未満でも公開する。**カテゴリ別count < 3 は基本属性でも非公開**（0含む。`minCell`）。
  単一選択で1カテゴリだけ伏せると逆算できるため、次に小さい公開値も伏せる（二次秘匿）。年代は4区分+「回答しない・その他」。
  居住地は保存値（`pref_01`〜`pref_47` / `overseas` / `other`）のまま、公開集計時のみ `schema.publicResults.residenceBlocks` の8地方ブロック
  （北海道・東北 / 関東 / 中部 / 近畿 / 中国 / 四国 / 九州・沖縄 / 海外・その他）へ再集約する。`minCell` と二次秘匿は再集約後のカテゴリに適用する。
  `aichi_area` は回答データとして保持するが、公開payloadには30件未満・以上・finalのすべてで含めない（`BASIC_PUBLIC_QUESTIONS` 外のため schema に足しても出ない）。
- 公開GASの再デプロイが必要（公開payloadの形式が変わるため）。フロントのみ先に出すと、更新前GASの `insufficient` 応答には従来の案内文で応答する。
- `finalizeSurvey()`（Apps Scriptエディタから**締切後に1回**手動実行）：
  `responseRows / validRows / lateRows / unparseableRows / publicTotal / finalizedAt / status:"final"` を算出し、公開payloadを
  Script Propertiesへチャンク保存（読み戻し検証後に確定マーカー）。以後Spreadsheetを書き換えても公開値は変わらない。
  二重実行は何も書き換えず確定済み統計を返す。途中失敗時はスナップショットを残さない。
  **締切前、締切時刻ちょうど（受付中）、および `SURVEY_CLOSES_AT` が未設定・不正値・存在しない日付の場合は確定を拒否**（`survey_not_closed` / `survey_close_not_configured`）。設定不正のまま確定して「有効回答0件」の誤った結果を固定しないため、締切値そのものを先に検証する。統計は `meta` シートにも書く。
- **Issueとの差**: Issue §9は「Admin GASがfinalize」と読めるが、既存方式（finalizeはPublic側のScript Propertiesへ固定）を踏襲し、
  AdminはSpreadsheetを**読み取り専用**に保つため、finalize実行はPublic GAS、Adminは `meta` シートから確定状態を**表示**する。

## Admin（管理ダッシュボード）: OWNER 1名専用の Apps Script Web App（Issue #363）

管理ダッシュボードを見るのは **OWNER 本人 1名だけ**。そのため、OAuth / ID token / OWNER-VIEWER 分離（Issue #354）は廃止し、
**Admin GAS の `/exec` を開くだけ**で OWNER 本人のみが利用できる構成にした。

### 方式

- UI は **Admin GAS 内の HTML**（`admin/Dashboard.html` + `DashboardStyles.html` + `DashboardScript.html`）。`doGet()` が返す。
- HTML からは **`google.script.run`** で `getDashboardData()` / `getCrosstabData(rowKey, colKey)` を呼ぶ（既存の集計 `Aggregate.gs` をそのまま利用）。
- アクセス制御は **Web App の設定のみ**（`appsscript.json` の `webapp`）。独自の共有パスワード・URL固定トークンは持たない。
- Admin GAS は Public GAS とは別プロジェクト・別デプロイ。Public 側・schema・Spreadsheet 列・公開結果は変更しない。
- Admin は読み取り専用（書き込み系API・メール送信・外部通信・Logger/console は存在しない。テストで静的検査）。

### Web App 設定（OWNER本人のみ）

| 設定 | 値 | 理由 |
|---|---|---|
| `executeAs` | `USER_DEPLOYING` | Spreadsheet をデプロイ者（OWNER）の権限で読む。**Spreadsheet を他のユーザーへ共有しない**（共有は不要）。 |
| `access` | `MYSELF` | デプロイ者本人（Googleにログイン済み）以外は `/exec` を開けない。URLを知っているだけでは第三者は利用できない。 |
| scope | `spreadsheets` のみ | `SpreadsheetApp.openById` に必須。`script.external_request`（旧: Googleの公開鍵取得）は不要になったため外した。 |

CI（`prepare-gas.js` / workflow の dry-run）は `access=MYSELF` かつ `executeAs=USER_DEPLOYING` かつ scope が `spreadsheets` のみでなければデプロイしない。

### 不要になったもの

**Google Cloud の設定・OAuth Client ID は不要**（作成しない）。次も不要になった。

- Google Identity Services / ID token / 署名・iss・aud・exp・email_verified 検証（旧 `IdToken.gs`）
- Script Properties `ADMIN_GOOGLE_CLIENT_ID` / `ADMIN_OWNER_EMAILS` / `ADMIN_VIEWER_EMAILS`（旧 `Auth.gs`）。残っていてもコードは読まず、管理画面の動作に影響しない
- VIEWER 向けレスポンスと allowlist、GitHub Pages 側の `config.js`（endpoint / googleClientId）、CORS 回避のための外部 POST
- 旧 GitHub Pages 管理画面: `community/costume-portrait-survey-admin.html` は **noindex の「移行済み」案内だけ**を残し、GAS の URL は載せない。`community/costume-portrait-survey-admin/` は削除した。

### Script Properties（Admin GAS）

`SPREADSHEET_ID`（Public と同じSpreadsheet）、`SURVEY_CLOSES_AT`（任意。締切後の行の判別用）のみ。

### 集計機能

OWNER 向けの集計は従来どおり（需要ファネル5種〔Issue #361 / PR #362〕・3か月以内層のクロス集計・照明/機材・イベント/少人数・自由記述・センシティブ項目を含む）。
今回の変更は認証・配信経路の簡素化のみで、集計ロジックと分母の定義は変えていない。

### 本番反映の手順（人手。**順序を変えない**）

> ⚠ `clasp update-deployment` は deployment の version を更新するだけで、Web App のアクセス設定（`access` / `executeAs`）を**変更しない**。
> 現行の本番 Admin は旧構成の `ANYONE_ANONYMOUS` のため、**先にアクセスを「自分のみ」へ変えずに新コードを配備すると、手動変更までの間、
> 誰でも管理ダッシュボード（自由記述・センシティブ項目を含む）へ到達できてしまう**。必ず「アクセス変更 → 配備」の順で行う。

1. main へマージ（PR の CI が pass していること）。
2. **【配備の前に】既存 Admin deployment のアクセスを「自分のみ」へ変更する**: Apps Script エディタ →「デプロイ」→「デプロイを管理」→ 既存の Web App deployment を編集 →
   「次のユーザーとして実行 = 自分」「アクセスできるユーザー = **自分のみ**（`MYSELF`）」→ 保存。`/exec` URL は維持される。
   （この時点では旧コードが動いているため、GitHub Pages の旧管理画面（未設定のまま）は元から使えず、影響はない。）
3. Actions *Costume portrait survey Admin GAS* を `workflow_dispatch`（Branch: `main`。SHA入力は不要で、実行開始時点の main HEAD = `github.sha` を固定してテスト・deployする）。
   入力 **`admin_access_set_to_myself` を、手順2を済ませた場合のみ ON** にする（OFF のままなら workflow / `deploy-gas.sh` は clasp を一切呼ばずに失敗する＝fail closed）→ Environment承認。
   既存の deployment を `update-deployment` するだけで、新規 deployment は作らない（`/exec` URL は変わらない）。
   旧 `Auth.gs` / `IdToken.gs` は `clasp push` で置き換わり削除される。
4. scope が変わった場合（`script.external_request` の削除）は、Apps Script エディタで一度関数を実行して再承認が必要か確認する。

注: この確認入力は人手の宣言であり、CI が deployment のアクセス設定を機械的に読み取って検証するものではない（clasp は access を取得できない）。
そのため手順2の実施と、下記「本番デプロイ後の確認」（未ログイン・別アカウントで拒否されること）を必ず行う。

### 本番デプロイ後の確認（OWNER本人のブラウザ）

- [ ] OWNER 本人のGoogleアカウントで `/exec` を開くと管理ダッシュボードが表示される
- [ ] 需要ファネルを含む全タブ（概要・単純集計・ファネル・需要ファネル・クロス集計・自由記述）が表示される
- [ ] 未ログイン（シークレットウィンドウ）または別のGoogleアカウントでは、`/exec` を開いてもダッシュボードもデータも表示されない
- [ ] 旧 GitHub Pages の管理画面URLは「移行しました」の案内だけが表示される
- [ ] 上記を確認後、不要になった Script Properties（`ADMIN_GOOGLE_CLIENT_ID` / `ADMIN_OWNER_EMAILS` / `ADMIN_VIEWER_EMAILS`）を手動で削除してよい（削除しなくても動作に影響しない）

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
   - Admin: `SPREADSHEET_ID`（同じSpreadsheet） / `SURVEY_CLOSES_AT`（Publicと同じ値。締切後の行の判別用、任意）。OAuth Client ID 等は不要。詳細は「Admin（管理ダッシュボード）」
6. **Web App deployment を各プロジェクトで1回だけ作成**し、Deployment ID と `/exec` URL を控える。
   - Public: 実行ユーザー=自分、アクセス=全員（匿名可）
   - Admin: 実行ユーザー=自分、アクセス=**自分のみ（`MYSELF`）**（CIは `MYSELF` + `USER_DEPLOYING` 以外ならデプロイしない）
7. Apps Scriptエディタで Public の `setupScriptProperties()`（salt生成）→ `setupSpreadsheet()`（`responses` / `meta` シートとヘッダー作成）を実行。
   このとき **OAuth承認**（Spreadsheet・`script.send_mail`）を行う。Adminは Apps Script エディタから一度関数を実行し、`spreadsheets` を承認する。
8. **GitHub Environment を2つ新規作成**（Settings → Environments）
   - `costume-portrait-public-production` / `costume-portrait-admin-production`
   - どちらも **Deployment branches = `main` のみ** + **Required reviewers（承認者）**
   - 各Environmentの **Secrets**（Environment単位で、対象GASの値を登録）:
     `CLASPRC_JSON`（clasp認証。GitHub Secretsのみ。コミット禁止）/ `COSTUME_PORTRAIT_SCRIPT_ID` / `COSTUME_PORTRAIT_DEPLOYMENT_ID`
   - ※ Environmentの作成・保護ルール・Secret登録はコードからは行えないため手動設定が必要。
9. `community/costume-portrait-survey/config.js` の `endpoint` に Public の `/exec` URL を設定してコミット。
   管理ダッシュボードは Admin の `/exec` URL を OWNER 本人がブラウザで開くだけ（リポジトリへの設定は不要）。
10. 公開前に `community/costume-portrait-survey.html` の `<meta name="robots" content="noindex…">` を外し、
    必要なら `community/index.html` / `sitemap.xml` に導線を追加する（現状は未公開のため追加していない）。

## 運用

- **コード更新**: PRで検証（本番は更新されない）→ mainへマージ → Actions の *Costume portrait survey Public GAS* /
  *Admin GAS* を `workflow_dispatch`（Branch: `main`、SHA入力なし・`github.sha` を固定）→ Environment承認 → `deploy-gas.sh`。
  既存deploymentを `update-deployment` するだけで、新規deploymentは作らず `/exec` URLは変わらない。
  Script Properties・`SPREADSHEET_ID` は変更しない。Public のWeb Appアクセス設定は変更しない（remoteの `webapp` を保持）。
  Admin の `webapp` はリポジトリ側（`MYSELF` / `USER_DEPLOYING`）が正。既存の `ANYONE_ANONYMOUS` 等からの移行は許可し、未知の値・許可外scope（メール送信・外部通信等）は拒否する。
- **schemaを変えるとき**: `survey.schema.json` を編集 → `npm run build` → コミット。回答開始後に設問構造を変える場合は
  `schema_version` を上げ、`responses` のヘッダーと整合させる（ヘッダー不一致時は保存を拒否する）。
- **受付中**: 有効回答30件以上で途中集計が公開される（運用操作は不要）。
- **締切後**: Public で `finalizeSurvey()` を実行 → `?action=results` と公開結果ページで「最終結果」表示を確認（30件以上のときのみ表示）。
