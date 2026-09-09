# 名古屋のフェチ・衣装交流に関するアンケート｜管理者・開発者向け分析ダッシュボード

Google Apps ScriptのHTML Serviceで動く、**読み取り専用**の管理者・開発者向け分析ダッシュボード。
`community/gas/nagoya_fetish_survey_webapp/`（公開アンケート＋公開結果ページ）が保存する
回答スプレッドシートを読み取り、詳細なクロス集計を表示する。

## なぜ公開プロジェクトと別のGASプロジェクトなのか（重要）

このダッシュボードは、**公開アンケートのApps Scriptプロジェクトとは意図的に別プロジェクト**として
作成する。「同じプロジェクトに`?view=admin`のような別ルートとして実装する」方式は採用しない。

理由：Google Apps ScriptのWebアプリは、公開デプロイ・限定公開デプロイのどちらであっても
同一プロジェクト内の同じ`doGet(e)`・同じ関数群を実行できてしまう。つまり「URLパラメータや
秘密トークンで管理画面への到達を制限する」という設計は、実装ミス・将来の変更・デプロイ設定の
見落としのいずれか1つで、公開URLの経路から管理画面（詳細クロス集計・自由記述閲覧等）に
到達しうるという構造的リスクを常に抱える。

このリスクを構造的に排除するため：

- 管理ダッシュボードは、公開アンケート・公開結果ページとは**別のApps Scriptプロジェクト**として作成する。
- このプロジェクトのWeb Appは、デプロイ時に**「アクセスできるユーザー：自分のみ」**を選択する。
- 公開プロジェクト（`nagoya_fetish_survey_webapp/Code.gs`）には、`Admin.html`・
  `getAdminResults()`・`view=admin`分岐・秘密トークン認証等を一切実装しない
  （`tests/test_read_only_and_isolation.js`で、公開プロジェクトのソースにこれらが
  存在しないことを継続的に検証している）。

## 読み取り専用であること

このプロジェクトのコードには、`responses`シートへの書き込み処理（`appendRow` / `setValue` /
`setValues` / `setFormula` / `clear` / `deleteSheet`等）を一切実装しない。回答の削除機能・
編集機能・スプレッドシートへの書き込み操作は持たない。集計はすべて
`getDataRange`相当（`getRange(...).getValues()`）で読み込んだ値をJavaScript側で加工するだけで、
スプレッドシート自体は一切変更しない。

`tests/test_read_only_and_isolation.js`が、書き込み系APIの呼び出しがソースコード中に
存在しないことを静的に検証している。

## 設問・選択肢の正本について

`Code.gs`内の`COLUMNS`・各種`*_OPTIONS`定数は、公開プロジェクトの`Code.gs`にある同名の定数の
**コピー**である。Apps Scriptはプロジェクトをまたいだモジュール共有ができないため、この重複は
構造上の制約であり1箇所に統合できない。

> **公開プロジェクト側で設問・選択肢を追加・変更・削除した場合は、このプロジェクトの
> 対応する定数も必ず同時に更新すること。** 自動テストでは両プロジェクト間の完全一致までは
> 検証できないため（別プロジェクトのため`vm`上で両方を同時ロードして比較する構成にしていない）、
> レビュー時に両ファイルを見比べて確認する。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `Code.gs` | サーバー側ロジック。`responses`シートの読み取り・集計（読み取り専用）。 |
| `Dashboard.html` | ダッシュボードの骨組み。 |
| `DashboardStyles.html` | `<style>`のみ。 |
| `DashboardScript.html` | クライアント側ロジック。`getAdminDashboardData()`の呼び出し・表・棒グラフの描画。 |

## 表示内容

- **基本**：総回答数、日別回答数、最終回答日時。
- **地域**：都道府県別、愛知県内地域別、全国7地域ブロック別（三重県は近畿に分類）。
- **年代**：元の7区分、公開結果と同じ簡略年代5区分の両方。
- **衣装**：`interest_categories`全22カテゴリ、`primary_interest_category`、`engagement_preferences`。
- **SNBC**：`snbc_awareness`・`snbc_interest`・`snbc_interest_uncertain_reasons`、
  ユニフォーム系ゲート到達数、深掘り到達数、認知→興味あり率。
- **スーツ**：`suit_engagement_preferences`・`suit_types`・`suit_states`・`suit_event_interest`。
- **深掘り**：`preferred_frequency`〜`gap_reasons`まで#292由来の深掘り設問一式。
- **分岐**：`survey_path`・`completion_stage`の単純集計。
- **上部の主要可視化**：SNBC認知→興味あり→深掘り完走のファネル、地域別SNBC興味、
  interest_categoriesランキング、engagement_preferences、参加しやすい料金・人数、参加障壁、
  場の温度感、アンケート〜申込ギャップ、スーツ企画への興味。
- **自由記述一覧**：ページ下部の折りたたみ（`<details>`）にのみ表示し、トップには表示しない。

管理画面では、公開結果ページでは出さない22カテゴリの個別ランキング・地域×年代×嗜好等の
詳細クロス集計を許可している（現時点では「地域7ブロック×SNBC興味」のクロス集計を実装。
他の組み合わせが必要になった場合は`buildHighlightsSection_()`・`Code.gs`の集計関数を
参考に追加する）。

## デプロイ手順

1. **新規Apps Scriptプロジェクトを作成する**（公開アンケートのプロジェクトとは別に、
   新規スタンドアロンプロジェクトを作成すること。既存の公開プロジェクトに追加しないこと）。
   [script.google.com](https://script.google.com) で新規作成し、このディレクトリの
   `Code.gs`・`Dashboard.html`・`DashboardStyles.html`・`DashboardScript.html`を
   同じファイル名で貼り付ける（`.html`拡張子のファイルとして追加すること）。
2. **SPREADSHEET_IDの設定**：公開アンケートプロジェクト側で使っている回答スプレッドシートと
   **同じ**スプレッドシートIDを使う（新規作成しない。公開側の`README.md`手順2でコピーした
   IDと同じもの）。Apps Scriptエディタ左側の「プロジェクトの設定」（歯車アイコン）→
   「スクリプト プロパティ」で、キー`SPREADSHEET_ID`に設定する。
3. **Web Appとしてデプロイ**：「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」。
   - 実行ユーザー：自分
   - **アクセスできるユーザー：自分のみ**（公開アンケートとは異なり、これが必須。
     「全員」や「Googleアカウントを持つ全員」を選ばないこと）
4. デプロイ後に表示されるURLを開き、初回はGoogleアカウントの権限承認を行う
   （要求される権限はスプレッドシートの読み取りとWebアプリの実行のみ）。
5. **動作確認**：ダッシュボードが表示され、公開アンケートの回答内容が集計値として
   反映されていることを確認する。回答を削除・編集するボタンが一切ないことも確認する。

設問・選択肢を変更した場合は、`Code.gs`の対応する定数を公開プロジェクト側と同時に更新した上で
再デプロイ（同じデプロイの「新しいバージョン」を選択）しないと反映されない。

## テスト

Apps Script自体はこの開発環境では実行できないため、`tests/`配下にNode.jsによる検証スクリプトを
置いている。

```sh
cd community/gas/nagoya_fetish_survey_admin/tests
npm test
```

- `test_backend.js`：`Code.gs`をNode.jsの`vm`モジュール上に読み込み、`readResponseRows_`
  （ヘッダ名ベースでの読み取り。列の並び替えに対しても壊れないことを確認）、`tallySingle_` /
  `tallyMulti_`（単純集計）、`crosstabSingleVsSingle_` / `crosstabMultiVsSingle_`
  （クロス集計）、各セクションのビルダー関数（`buildRegionSection_`等、三重県→近畿の
  マッピングを含む）、`buildAdminDashboardPayload_`（自由記述がトップの主要可視化に
  含まれないことを含む）を検証する。
- `test_read_only_and_isolation.js`：
  - 管理プロジェクトのソースコードに書き込み系API（`appendRow`・`setValue`・`clear`・
    `deleteSheet`等）の呼び出しが一切存在しないこと（読み取り専用であることの検証）。
  - 公開プロジェクト（`nagoya_fetish_survey_webapp/Code.gs`）に`getAdminResults`・
    `getAdminDashboardData`・`view=admin`分岐・管理用HTML・秘密トークン認証等が
    一切存在しないこと（プロジェクト分離が保たれていることの検証）。

以下はApps Scriptの実行環境が前提のため、この開発環境では自動テストできず、
**デプロイ後に手動での確認が必要**。

- [ ] 実際のスプレッドシートに対して`getAdminDashboardData()`を実行し、エラーなく
      ダッシュボードが表示されることの確認。
- [ ] 公開結果ページ（`/exec?view=results`、n<5非表示・total<10非表示あり）と、
      この管理ダッシュボード（全件表示）の集計値の傾向が矛盾しないことの確認。
- [ ] Web Appのアクセス権が「自分のみ」になっていることを実際のデプロイ設定画面で確認。
- [ ] 自分以外のGoogleアカウントでデプロイURLにアクセスし、アクセス拒否されることの確認。
