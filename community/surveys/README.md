# アンケート・調査アーカイブ（community/surveys/）

URL: `/community/surveys/`（Issue #401）

- `surveys.json` … ポータル専用の公開用データ。運営提供の surveys.json（schema_version 1）から**表示に必要な項目だけ**を抜粋したもの。
- `surveys.js` … surveys.json を読んでカードを描画（`portal.section` で区分、`portal.sort_date` 降順）。
- 検証: `community/tests/test_survey_archive.js`（`cd community/tests && npm test`）

## データの扱い
- `null` は「不明」。推測で補完しない。JS は null の項目を表示しない。
- `status=unknown` は「公開状況確認中」と表示し、「回答受付中」と断定しない。
- `link_policy: "none"` の調査は URL を持たせず、CTA を出さない（README の「緊縛事業（ataru-nagoya）へのリンクをこのサイト内に追加しない」ルールに従う）。
- **例外（Issue #404）**: `ataru_rope_interest_2026`（緊縛・ロープへの関心アンケート）のカードに限り、公開済みの最終結果ページ `https://nagoya-base.github.io/ataru-nagoya/survey-results.html` への「結果を見る」CTA のみ掲載する。
  - `link_policy: "results_only"` は「`results_url` の CTA だけ許可（`public_url` は参照せず『アンケートを見る』も出さない）」の意味。`public_url` は `null` のまま。
  - Ataru のトップ・回答フォーム・その他ページへのリンクは追加しない。他の調査へ `results_only` を使う場合も、個別に明示的な指示が必要。
  - 上記以外の「緊縛事業（ataru-nagoya）へのリンクを追加しない」ルールは変更なし。
- 内部パス・運営用ダッシュボード・Admin/GAS・注記（note）・回答者単位データは含めない。
- 独立アンケートとして掲載しないもの: prototype、イベント申込、初参加エントリー、運営用集計画面。
- 調査同士の設問・回答は統合・変換しない。
- `portal.sort_date` は並び替え専用。画面には表示しない（実施時期は確定している `survey_period` のみ。不明なら省略）。
- 設問数は `question_count_label`（表示専用）を優先。値が食い違う調査は `question_count: null` で省く。
- `survey_period_label`（表示専用）で人間向けの表記を上書きできる。正本の締切値（`survey_period.end`）は変更しない。
