# 名古屋野球ユニ部アンケート（design v2.17）

親Issue #377 / 本ディレクトリの範囲は Issue #378（schema 正本の配置・参照整合 validation・CI）です。
Public GAS・core・Frontend・Admin・公開結果ページは後続Issue（#379〜）で追加します。

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

`tests/schema.test.js` は実 schema に対する検査と v2.17 の回帰（低関心 route の 3 参照、`activity_stopped_reasons`、`adult_context`、`exercise_*`）、
`tests/validator.test.js` は validator が壊れた schema を検出することの負例テストです。

CI: `.github/workflows/baseball-uniform-survey-schema.yml` が PR ごとに上記を実行します（deploy・secret は使いません）。

## 公開 repo 上の注意

GitHub Pages は repository 全体を公開対象にします。このディレクトリには次を置きません。

- 実回答、CSV、Spreadsheet export、個票、free text dump、実データの test fixture
- salt / token / secret（server-side の Script Properties 等にのみ置く）

テストの入力は schema をメモリ上で書き換えた架空データだけです。
