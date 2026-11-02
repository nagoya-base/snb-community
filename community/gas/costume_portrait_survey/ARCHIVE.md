# アーカイブ記録：男性の衣装・ポートレート意識調査（Issue #452）

終了時点の状態を後から確認・再現するための記録。**秘密情報（Spreadsheet ID・token・salt・認証情報・`CLASPRC_JSON`）は書かない。**
確定値は 2026-11-02 の `finalizeSurvey()` 実行・本番デプロイ後に反映済み（出典：Issue #452 のコメント）。retention 期限のみ未確定。

| 項目 | 値 |
|---|---|
| survey 名 | 男性の衣装・ポートレート意識調査（`ユニ・スーツ・衣装で、撮ってもらいたい？撮りたい？`） |
| survey_id | `costume_portrait_2026` |
| survey_version / schema_version | `2026-10` / `3`（`survey.schema.json`） |
| design version | schema_version 3 の画面構成（衣装カテゴリ拡張後）。`git log -- survey.schema.json` で追跡 |
| close 日時（`SURVEY_CLOSES_AT`） | `2026-10-31T23:59:59+09:00` |
| 最終 production 有効回答数 | 40（`finalize_validRows` = `finalize_publicTotal` = 40） |
| 内訳（response / late / unparseable） | 40 / 0 / 0（`finalize_responseRows` / `finalize_lateRows` / `finalize_unparseableRows`）。`duplicate_rejects` = 0 |
| 最終 snapshot 生成日時（`finalized_at`） | `2026-11-02T10:28:06.774Z`（JST 2026-11-02 19:28:06.774） |
| final public data の識別 | Script Property `FINAL_RESULTS_META`（chunks 数・stats）／`status:"final"`。`GET ?action=results` が `status:"final"`・`total:40` を返すことを確認済み（`finalize_status` = `final`） |
| 最終 deploy の commit SHA | `09b337bcadb69f11f82e29f4d5ee955a15c8ca77`（PR #453 の merge commit。Public GAS / Admin GAS を本番デプロイ済み） |
| 使用中 Deployment ID の対応 | Public: Environment `costume-portrait-public-production` の `COSTUME_PORTRAIT_DEPLOYMENT_ID` ／ Admin: `costume-portrait-admin-production`（値は GitHub Secrets 参照。このファイルには書かない） |
| retention policy | `closes_at` を起算点とする。`SURVEY_CLOSES_AT` を正式な起算点として扱う |
| retention 期限 | **未確定**。本調査の保持日数はリポジトリ上で確定値を確認できていない（別調査の365日設定は流用しない）。保持期間の確定後に `SURVEY_CLOSES_AT`（2026-10-31T23:59:59+09:00）+ 保持日数で算出して追記する |

## 終了手順（人手。順序を変えない）

1. 受付終了：`SURVEY_CLOSES_AT` 経過後は Public GAS が `survey_closed` を返す（Backend が最終権威）。**Frontend だけを終了表示にしない。**
2. 締切後に Public で `finalizeSurvey()` を1回実行する（締切前・締切設定不正は拒否される）。
   内部順序：行抽出（test / 締切後 / 日時不正を除外）→ 公開 payload 生成 → `assertPublicPayload_` → 件数整合（`total_mismatch`）→ チャンク保存 → 読み戻し検証 → **確定マーカー（`FINALIZED_AT`）を最後に設定**。
3. 件数の整合を確認：Admin の「有効回答数」＝ `meta.finalize_validRows` ＝ `?action=results` の `total`。
4. 本番デプロイ後に実環境で確認：回答ページが終了表示／結果ページが「最終結果」表示／`?action=results` が `status:"final"`／終了後の直接 POST が `survey_closed`。
5. 上表の `確定時に記入` を埋める。
6. raw 回答は削除しない。期限到来後に別途 `dry-run → confirmation → execute → rescan / audit` で処理する。

## 次回調査

終了済みの本 survey / Spreadsheet / Public・Admin GAS へ schema や新規回答処理を継ぎ足さない。次回は新しい survey_id・Spreadsheet・GAS プロジェクトとして作る。
