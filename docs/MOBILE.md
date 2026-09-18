# Android / iOS版 folio

ReactのPDF編集画面をCapacitor 8のネイティブWebViewに同梱する構成です。アプリの起動に開発サーバーは不要です。画面の日本語・英字フォントも同梱し、起動時の外部フォント取得をなくしています。PDF表示、白紙メモ、手書き、消しゴム、暗記モード、フォルダ管理、自動退避は端末内で動作します。画像・OfficeファイルのPDF変換だけはサーバーとの通信が必要です。

## 対応範囲

| 項目 | Android | iOS / iPadOS |
| --- | --- | --- |
| 設定上の対応下限 | Android 10（API 29） | iOS 16 |
| PDF表示 | Android System WebView 120以上 | OS標準WKWebView＋互換処理 |
| プロジェクト | `android/` | `ios/App/App.xcodeproj` |
| アプリID | `app.folio.student` | `app.folio.student` |
| 外部保存 | OSのファイル保存画面（Storage Access Framework） | 「ファイル」の書き出し画面（UIDocumentPicker） |

下限OSの設定と実機動作確認は別です。配布前には下記チェックリストを実機で確認してください。Android System WebViewは端末のストアから更新してください。

Web版のIndexedDBとアプリ内WebViewのIndexedDBは別の保存領域です。ブラウザの資料がアプリへ自動移行されることはありません。資料・下書きはアプリを閉じても保持しますが、アンインストールやアプリデータ消去で失われます。端末間同期・アカウント・課金・AIモデル接続はまだありません。

## 開発環境と同期

Node.js 22以上を使います。OS共通の変更後は必ずWebのビルドとネイティブプロジェクトへの同期を実行します。

```sh
npm ci
npm run mobile:sync
```

`capacitor.config.json`の`webDir`は`dist`です。リモート画面を読み込む`server.url`は設定しません。iOSの依存管理はSwift Package Managerです。アプリIDを変える際は、Capacitor設定だけでなくAndroidの`applicationId`／namespace／Java packageとXcodeのBundle Identifierも揃えてください。

## Android APK

Android Studio 2025.2.1以上、JDK 21、Android SDK Platform 36が必要です。必要なBuild ToolsはGradleが取得します（この環境では35.0.0と36.0.0を準備済み）。Android StudioのSDK Managerでインストールし、`JAVA_HOME`と`ANDROID_HOME`を設定してください。

```sh
npm run android:build
# 出力: artifacts/folio-android-debug.apk

# IDEで開く
npm run android:open
# 接続した端末 / エミュレータで実行
npm run android:run
```

この作業環境では、必要なツールを`.runtime/mobile-build`に配置し、`scripts/build-android.mjs`がローカル設定を読みます。他のPCではAndroid Studioの環境を優先します。`.runtime`をコピーする必要はありません。

APKは開発用のデバッグ署名です。端末に転送してインストールするか、開発者向けオプションとUSBデバッグを有効にして次を実行します。

```sh
adb install -r artifacts/folio-android-debug.apk
```

Google Play用には所有者のリリース署名鍵でAABを作成してください。署名鍵、アカウント、ストアへの公開設定は含めていません。Androidの全ストレージアクセス権限は使わず、ユーザーが選んだURIだけに書き込みます。

## iOS / iPadOS

macOSとXcode 26以上が必要です。LinuxではiOSのコンパイル、シミュレータ、IPAの作成はできません。

```sh
npm ci
npm run mobile:sync
npm run ios:open
```

1. XcodeがSwift Packageの依存を取得するのを待ちます。
2. Appターゲットの「Signing & Capabilities」で自身のTeamを選択します。必要なら一意なBundle Identifierに変更します。
3. iPhone / iPadシミュレータ、または接続した端末を選び、Runします。
4. TestFlight等への配布は、実機向けArchiveを作成して署名・アップロードします。Apple Developer側の準備が必要です。

カスタム保存プラグインは`FolioFilesPlugin.swift`に実装し、`FolioViewController`で登録しています。`SceneDelegate`とStoryboardの両方からこのViewControllerを使います。保存キャンセルは通常の結果として扱い、元PDFや下書きを消去しません。

## 変換サーバー

アプリの「資料を追加」またはプロフィールにある「変換サーバーの設定」を開き、自分で管理するHTTPSサーバーURL（例: `https://your-server.example`）を保存してください。`/api`を含まないベースURLです。最初から接続先を組み込む場合は、ビルド前に`VITE_CONVERSION_SERVER`を設定できます。この値はアプリ内で見える公開URLです。

```sh
# 変換サーバー側
npm run setup:office  # Linuxで未準備の場合
npm run build
npm start
# localhost:3001 をHTTPSのリバースプロキシ経由で端末から到達できるようにする
```

アプリにはユーザーのサーバーURLや認証情報を仮定して埋め込んでいません。未設定でもPDFの追加・編集はできます。画像・Word・PowerPoint・Excelは接続先設定後に使えます。

APIは`capacitor://localhost`（iOS）と`https://localhost`（Android）のOriginを明示的に許可します。別ドメインのWeb版を使う場合だけ、サーバーの`FOLIO_ALLOWED_ORIGINS`にカンマ区切りで追加してください。CORSは認証の代わりではありません。既存APIは個人・開発利用向けで、公開サービスとしての認証・利用者別制限は未実装です。

端末の`localhost`は開発PCを指しません。自己署名証明書の検証を無効化したり、HTTPの平文通信を全許可したりする設定は加えていません。

## 保存動作とコードの分離

- Web版: 「保存先を選んでPDFを保存」で、編集済みPDFをブラウザからダウンロード。
- ネイティブ版: 同じボタンで、OSのファイル保存画面を表示。成功・キャンセル・失敗を区別。
- `mobile-runtime.js`: プラットフォーム判定、ネイティブブリッジとのデータ変換。
- `external-storage.js`: Web / ネイティブの書き出しを振り分け。
- `server-connection.js` / `ServerSettings.jsx`: 変換サーバーの接続設定。
- `FolioFilesPlugin.java` / `.swift`: OSの保存画面とファイル書き込み。
- `storage.js`: Web版と共通のIDベースの資料・注釈・下書き管理。

Androidの戻るボタンでは、保存ダイアログ・PDF・フォルダ・ホームの順に戻ります。ホームではアプリをバックグラウンドへ移します。手書きの退避は従来どおり編集ごとに行い、終了イベントに依存しません。

アイコンは`public/folio-icon.svg`が元データです。変更後は`node scripts/mobile-icons.mjs`を実行してください。

## 検証

```sh
npm test
# npm run devを起動した状態で
npx playwright test
npm run android:build
```

ブラウザテストはネイティブ保存ブリッジをモックで検証します。Java / SwiftのOSダイアログ自体や実機でのファイル操作を保証するものではありません。

配布前の実機チェック:

- iPhone / iPad / AndroidでPDF・画像・DOCXを取り込み、変換結果を開ける。
- ペン・消しゴム・暗記マーカー・Undo/Redoと、縦横画面・ソフトキーボードで操作できる。
- アプリ終了後の下書き復元、キャンセル、複製後の編集の独立性。
- OSのファイル保存画面で保存／キャンセル／書き込みエラーを確認し、外部PDFビューアで再読込する。
- 大きなPDF、バックグラウンドからの復帰、ストレージ不足、オフライン、変換サーバーへの接続失敗。

公式資料: [Capacitor環境設定](https://capacitorjs.com/docs/getting-started/environment-setup)、[Androidプラグイン](https://capacitorjs.com/docs/plugins/android)、[iOSプラグイン](https://capacitorjs.com/docs/plugins/ios)。

### iOSの署名なしコンパイル確認（Mac）

```sh
npm run mobile:sync
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build
```

これでシミュレータ向けコードのコンパイルを確認できます。実機へのインストールやIPAへの書き出しには適切な署名が必要です。

## クラウドでビルド・署名する場合

ローカルにMacを用意せず、GitHub Actionsで署名済みAPK・AAB・IPAを生成できます。[クラウドビルド設定](CLOUD-BUILD.md)にSecretsの一覧と実行手順をまとめています。
