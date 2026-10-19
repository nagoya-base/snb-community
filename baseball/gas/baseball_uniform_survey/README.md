# 名古屋野球ユニ部アンケート（design v2.17）

親Issue #377 / 本ディレクトリの範囲は Issue #378（schema 正本の配置・参照整合 validation・CI）と Issue #379（専用 survey-core の fork と v2.17 構文対応）です。
Public GAS・Frontend・Admin・公開結果ページ・deploy は後続Issue（#380〜）で追加します。

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
この schema から生成されるファイルは現時点でありません（生成物を直接編集する構成にはしません）。

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
| stale 値 | `findStaleValues`（`hidden` / `option_unavailable` / `other_text_stale`）/ `sanitizeAnswers`（変化がなくなるまで除去） |
| 検証 | `validateAnswers(schema, answers, otherTexts)`（required は visible のみ、hidden の値は `hidden_field`）/ `findTermination` |
| test mode | `getTestMode` / `isProductionResponseMode` |

`denominator: question_reached` を正とし、Public payload の `targetCount` は `countQuestionReached`（その設問に実際に到達した有効回答者数）と**同じ概念**です。別概念としては実装しません。

test mode の正本は `response_mode + test_run_id` です。`preview_no_submit` / `closed_view` は client-only、`submit_excluded` のみ serverVerified で `response_mode = 'test'` として保存されます。core は mode の分類だけを返し、token の検証・保存は行いません。`response_mode` が欠損・未知値の場合は本番扱いにしません（fail-closed）。

### #380 / #381 での再利用前提

- 本ファイルは `module.exports`（Node.js）とグローバル `SurveyCore`（ブラウザ・Apps Script）の両方で使える ES5 です。schema は引数で受け取るため、Public GAS / Frontend / Admin へ**同一内容で配布**する生成・build は #380 以降で追加します（本 Issue では行いません）。
- server validation は `sanitizeAnswers` 後の payload を `validateAnswers` に通す想定です。Frontend は hidden になった設問の旧値を送信前に `sanitizeAnswers` で除去します。
- 本 Issue の範囲外（#380 以降）: respondent hash の canonical serialization、最短回答時間の server 検証、test token（URL fragment → sessionStorage → POST body）の検証、保存、Public GAS endpoint、Frontend UI、Admin、public snapshot、Spreadsheet、deploy。

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

`tests/schema.test.js` は実 schema に対する検査と v2.17 の回帰（低関心 route の 3 参照、`activity_stopped_reasons`、`adult_context`、`exercise_*`）、
`tests/validator.test.js` は validator が壊れた schema を検出することの負例テストです。

CI: `.github/workflows/baseball-uniform-survey-schema.yml` が PR ごとに上記を実行します（deploy・secret は使いません）。

## 公開 repo 上の注意

GitHub Pages は repository 全体を公開対象にします。このディレクトリには次を置きません。

- 実回答、CSV、Spreadsheet export、個票、free text dump、実データの test fixture
- salt / token / secret（server-side の Script Properties 等にのみ置く）

テストの入力は schema をメモリ上で書き換えた架空データだけです。
