# アンケート・調査アーカイブ（community/surveys/）

URL: `/community/surveys/`（Issue #401）

- `surveys.json` … ポータル専用の公開用データ。運営提供の surveys.json（schema_version 1）から**表示に必要な項目だけ**を抜粋したもの。
- `surveys.js` … surveys.json を読んでカードを描画（`portal.section` で区分、`portal.sort_date` 降順）。
- 検証: `community/tests/test_survey_archive.js`（`cd community/tests && npm test`）

## データの扱い
- `null` は「不明」。推測で補完しない。JS は null の項目を表示しない。
- `status=unknown` は「公開状況確認中」と表示し、「回答受付中」と断定しない。
- `link_policy: "none"` の調査は URL を持たせず、CTA を出さない（README の「緊縛事業（ataru-nagoya）へのリンクをこのサイト内に追加しない」ルールに従う）。
- 内部パス・運営用ダッシュボード・Admin/GAS・注記（note）・回答者単位データは含めない。
- 独立アンケートとして掲載しないもの: prototype、イベント申込、初参加エントリー、運営用集計画面。
- 調査同士の設問・回答は統合・変換しない。
