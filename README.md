# folio

大学生向けの授業資料・過去問管理アプリです。

授業ごとに散らばる資料をフォルダで整理し、PDFの閲覧、書き込み、暗記用マーカー、編集済みPDFの書き出しまでを一つのアプリで行います。

**現在の提出版で取り込めるのはPDFのみです。** 正式リリース版ではWord・PowerPoint・画像などをサーバー側で自動的にPDFへ変換する予定です。変換APIの実装はありますが、現在の画面からは利用しません。

## 主な機能と実装範囲

- PDF取り込み（50 MBまで）、閲覧、検索、お気に入り
- フォルダ作成・階層移動・名前変更・移動・複製・削除
- 手書き、蛍光ペン、線単位の消しゴム、Undo / Redo
- 色や不透明度を変更できる暗記用マーカーと黒塗り表示
- 白紙PDFによる手書きメモ、資料ごとのテキストメモ
- 編集途中の自動退避と、再起動時の復元確認
- 差分保存・PDFへの埋め込み・コピー保存・外部書き出し
- CapacitorによるAndroid / iOS版と、GitHub Actionsでのビルド

AIアシスタントは、PCのlocalhost版でCLIProxyAPI経由のPDF質問に対応します。利用者のローカルAPIキーが必要です。初期モデルは `gpt-6-luna`。認証環境での実接続は未確認で、自動問題生成・OCR・複数資料検索は対象外です。[AI接続手順と制約](docs/AI.md)を参照してください。

## Tech Stack

React / Vite / Capacitor / PDF.js / pdf-lib / IndexedDB / Express / LibreOffice / sharp

Reactで画面、PDF.jsで表示、pdf-libでPDF作成・編集、IndexedDBで端末内保存を行います。Express・LibreOffice・sharpは将来の自動変換向けに分離したサーバー実装です。

## ローカルで起動する

Node.js **24**とnpmを推奨します（CIもNode 24）。

```sh
npm ci
npm test
npm run build
npm run dev
```

ブラウザで **http://localhost:5173** を開きます。`npm run dev`はVite（5173）とAPI（3001）を起動します。PDFの取り込み・編集にLibreOfficeのセットアップやサーバーURLの入力は不要です。

初回に表示する資料は画面確認用のサンプルで、実PDFではありません。実際の編集を評価する際は、自分のPDFを追加するか「新しいメモ」で白紙PDFを作成してください。

ビルドしたWeb版を確認する場合は `npm run build` の後に `npm start` を実行し、http://localhost:3001 を開きます。

## 5分で確認する操作

1. 「すべての資料」でフォルダを作り、PDFを追加する。
2. PDFを開き、ペン・マーカー・消しゴム・Undo / Redoを操作する。
3. 暗記マーカーを引き、暗記モードを切り替える。
4. 保存から「変更分だけアプリに保存」を選び、再度開いて編集を確認する。
5. 複製後の資料を編集し、元の資料が変わっていないことを確認する。
6. アプリ外へ編集済みPDFを書き出し、別のPDFビューアで開く。

## 設計上のポイント

- **ローカルファースト**：PDF本体、注釈、フォルダ情報を端末内のIndexedDB（`folio-pdf`）へ保存します。下書きはIndexedDBとlocalStorageへ退避し、復元前にユーザーへ確認します。
- **PDFと注釈の分離**：元PDFとは別に、ページに対する正規化座標でストロークを保持します。表示時はPDF.jsのcanvas上に注釈canvasを重ね、拡大・縮小に追従します。
- **IDで参照**：資料とフォルダはID・parentIdで管理します。名前変更や移動ではIDを維持し、複製時は新しいIDを発行して編集を独立させます。
- **保存処理の境界**：ファイル管理UIは`library-repository.js`を介して保存処理を呼び出します。将来の保存先追加を意識していますが、PDFビューアの注釈・下書きには`storage.js`を直接呼ぶ部分もあり、クラウド同期には追加設計が必要です。
- **変換処理の分離**：Office変換はLibreOffice、画像変換はsharpを使うサーバーAPIとして分離しています。UIが変換エンジンを持たない構成です。
- **モバイルでの共通利用**：CapacitorにWeb画面を同梱し、OSのファイル保存画面やAndroidの戻る操作をネイティブ機能と連携させています。

## コードの読み方

| ファイル・ディレクトリ                               | 役割                                           |
| ---------------------------------------------------- | ---------------------------------------------- |
| `src.jsx`                                            | アプリ画面、ナビゲーション、画面状態の組み立て |
| `features/upload/import-pdf.js`                      | PDF取り込みの検証と登録                        |
| `hooks/useMobileBackButton.js`                       | モバイルの戻る操作                             |
| `FileExplorer.jsx` / `FolderPicker.jsx`              | 資料管理・保存先選択                           |
| `library-model.js`                                   | 名前・親子関係・移動などのルール               |
| `library-repository.js` / `storage.js`               | 保存操作の窓口 / IndexedDB実装                 |
| `PdfViewer.jsx` / `annotations.js` / `pdf-export.js` | PDF編集画面 / 注釈操作 / 編集済みPDF生成       |
| `external-storage.js` / `mobile-runtime.js`          | 外部書き出しとネイティブ連携                   |
| `server/`                                            | 将来の自動変換向けAPI・変換エンジン            |
| `android/` / `ios/`                                  | Capacitorネイティブプロジェクト                |
| `tests/`                                             | ロジック・API・ブラウザ操作のテスト            |

全面的な構成変更は避け、既存のimportとネイティブ連携を保ったまま整形・小さな責務分離を行っています。

## 保存の仕様

| 保存方法     | 結果                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| 差分保存     | 元PDFを保持し、注釈を別保存。再編集・暗記切り替えが可能                          |
| 上書き       | アプリ内PDFに注釈を埋め込み、差分をクリア                                        |
| コピー       | 新しいIDで編集済みPDFを作成                                                      |
| 外部書き出し | 現在の注釈を埋め込んだPDFを、Webではダウンロード、モバイルではOSの保存画面へ渡す |

埋め込み済みの線や元PDFの文字・画像は消しゴムで消せません。テキストメモはPDF本体には埋め込みません。上書きはアプリ内のPDFが対象で、最初に取り込んだ外部ファイルは変更しません。

アプリ内フォルダはIDと親子関係による論理構造です。OS上のフォルダを直接操作するものではありません。Webブラウザとネイティブアプリのデータは別々です。アプリの削除・サイトデータの消去で資料が失われるため、必要なPDFは外部に書き出してください。資料一覧のJSON書き出しにはPDF本体・手書きは含まれず、完全バックアップではありません。

## Android / iOSビルド

```sh
npm run mobile:sync
npm run android:build   # JDK 21・Android SDK 36が必要
npm run ios:open        # macOS・Xcode 26以上が必要
```

設定上の対応下限はAndroid 10（WebView 120以上）・iOS 16です。全対象OSでの動作保証を意味しません。

GitHub Actionsの **Mobile build and release test** はpushまたは手動で実行します。

| モード                 | 成果物                                                        |
| ---------------------- | ------------------------------------------------------------- |
| 既定のAndroid          | デバッグAPK                                                   |
| 既定のiOS              | Simulator用ZIPと、AltStore Classicでの再署名用の未署名実機IPA |
| 手動の`signed_release` | Secretsを使った署名済みAPK・AAB・IPA                          |

ローカル手順は[モバイル開発](docs/MOBILE.md)、Secrets・Artifacts・AltStore手順は[クラウドビルド](docs/CLOUD-BUILD.md)を参照してください。iOS実機向けビルドはクラウド上で成功した報告がありますが、IPA生成後のインストールや全実機機能の検証は未完了です。ストア公開済みではありません。

## テストと整形

```sh
npm ci
npm test
npm run build
npm run format:check
# コード整形
npm run format
```

`npm test`は注釈・消しゴム・ファイル管理ルール・画像変換・Office変換を対象とします。既存のOfficeテストはLibreOfficeが利用できない環境では理由付きでskipします。画像変換等のテストはそのまま実行します。

ブラウザテストは開発サーバーを起動した別ターミナルで実行します。

```sh
npx playwright install chromium
npx playwright test --grep-invert @office
# LibreOfficeを準備済みなら、変換APIと生成PDFの確認も含める
npx playwright test
```

Office変換を開発目的で検証する場合、Ubuntu/Debianでは `npm run setup:office`、その他の環境ではLibreOfficeをインストールします。必要に応じて`LIBREOFFICE_BIN`を指定します。現在の製品UIにはOfficeアップロードや接続先設定はありません。

## 制約・今後の課題

- 認証、利用者別管理、クラウド同期、自動バックアップ：未実装。
- AI：ローカルGateway接続と単一PDFの文字抽出・質問に対応。実認証での推論は未確認。モバイルAI接続・OCR・横断検索・自動問題生成は未対応。
- サブスクリプション、ストア公開：未実装・未実施。
- Office・画像：変換APIは実装済み。正式リリースでの自動変換UIとの統合・運用は今後の課題。
- 公開サーバー運用：認証・利用者別レート制限は未実装。CORS、入力サイズ制限、同時変換数制限は認証の代替ではありません。
- Officeのレイアウト再現はLibreOfficeとフォントに依存します。パスワード付きPDFは未対応です。
- 実機品質：最低OS、巨大PDF、低容量、バックグラウンド復帰、再署名後の更新について継続確認が必要です。

提出前の確認事項と検証記録は[提出チェックリスト](docs/SUBMISSION.md)にまとめています。
