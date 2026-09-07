# テスト（Node.js + jsdomによる代替検証）

Apps Scriptの実行環境（`SpreadsheetApp` / `LockService` / `HtmlService`実体）はNode.js上に
再現できないため、これらのテストは以下を検証する代替手段である。

- `test_backend.js`：`Code.gs`をNode.jsの`vm`モジュール上にそのまま読み込み、
  `validateAnswers_` / `buildRowValues_` 等の**純粋なロジック**（GAS APIを呼ばない部分）を
  直接呼び出して検証する。
- `compare_arrays.js`：`Code.gs`（サーバー側・正本）と`Script.html`（クライアント側・表示用コピー）
  内の選択肢配列が完全に一致しているかを検証する。**設問・選択肢を変更したときに
  片方だけ更新してしまう事故を検出するための最重要テスト。**
- `test_frontend.js`：`Index.html` + `Script.html` を実際にjsdom上でレンダリングし、
  `google.script.run`をスタブに差し替えたうえで、フォーム操作（選択・入力・送信）を
  シミュレートする。条件分岐表示・必須バリデーション・「その他」自由記述・送信時の
  ペイロード内容などを検証する。

以下は検証できない（デプロイ後の手動確認が必要。詳細は親ディレクトリの`README.md`参照）。

- 実際のGoogleスプレッドシートへの保存・重複判定（`LockService`込み）
- 実ブラウザでのCookie永続性（特にSafari/iOS）
- 実機でのスマホUI表示

## 実行方法

```sh
cd community/gas/nagoya_fetish_survey_webapp/tests
npm install
npm test
```

`Code.gs` / `Script.html` の設問・選択肢を変更した場合は、コミット前に必ず`npm test`を
実行し、特に`compare_arrays.js`が全項目`OK`になることを確認すること
（サーバー・クライアントの正本が2箇所に分かれている以上、ここでの一致確認が
唯一の安全網になる）。
