# クラウドでのビルドと署名

GitHub Actions の `.github/workflows/mobile-release-test.yml` を追加しています。Android は Linux、iOS は macOS 26 / Xcode 26以上のクラウドランナーを使用します。Dockerfile は変換サーバー用で、iOS のビルドには使いません。

## 初回設定

1. このプロジェクトを `.github/`、`android/`、`ios/`、`package-lock.json` を含めて GitHub リポジトリへ登録します。`.runtime` や `node_modules` は不要です。
2. Settings → Environments で `mobile-release` を作成し、下記の Secrets を登録します。署名の実行を制限したい場合は環境のブランチ制限・承認ルールを設定できます。
3. 変換サーバーを初期設定したい場合は同環境の Variables に `VITE_CONVERSION_SERVER` を HTTPS URL で登録します。空ならアプリ内で後から設定できます。
4. Actions → **Mobile build and release test** → **Run workflow** でプラットフォーム、ビルド番号、iOS配布方式を選びます。ワークフローはデフォルトブランチに登録してください。
   - `signed_release` がオフ（初期値）なら署名SecretsなしでAndroidデバッグAPKとiOSシミュレータ用アプリを生成します。iOSシミュレータ用ZIPはiPhone実機にはインストールできません。
   - 署名済みAPK・AAB・IPAが必要な場合は `signed_release` をオンにして、下記Secretsを登録してください。
5. 完了後、実行画面の Artifacts から成果物をダウンロードします。ストアへの自動アップロード・公開は行いません。

ビルド番号は毎回増やす正の整数（最大9桁）です。再実行時も配布済み番号を使い回さず、新しい番号で起動してください。表示バージョンは `package.json` の `version`（`1.0.0` 形式）を使います。

## Android の Secrets

| 名前 | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | リリース用 keystore ファイル全体の Base64 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore パスワード |
| `ANDROID_KEY_ALIAS` | 鍵の alias |
| `ANDROID_KEY_PASSWORD` | 鍵のパスワード |

初回の鍵は JDK の `keytool` 等で作成し、以後の更新でも同じ鍵を保持してください。Google Play App Signing 利用時はアップロード鍵を指定します。既存のデバッグAPKとは署名が異なるため、そのまま上書きインストールはできません。削除すると端末内資料も消えるため、必要なPDFを先に書き出してください。

成果物: `folio-android-release.apk`（端末向け）、`folio-android-release.aab`（Google Play向け）。スクリプトは APK の署名検証と AAB の署名存在・検証を実行します。

## iOS の Secrets

| 名前 | 内容 |
| --- | --- |
| `IOS_CERTIFICATE_BASE64` | 秘密鍵を含む Apple Distribution 証明書 `.p12` の Base64 |
| `IOS_CERTIFICATE_PASSWORD` | `.p12` のパスワード（空は不可） |
| `IOS_PROFILE_BASE64` | 配布用 `.mobileprovision` の Base64 |
| `IOS_TEAM_ID` | Apple Developer の Team ID |

Apple Developer で `app.folio.student` の明示的な App ID と配布プロファイルを準備してください。Bundle ID を変更する場合は Xcode の設定、`capacitor.config.json` と `scripts/ci/mobile-release.py` の `bundle` も変更します。

- `app-store-connect`: App Store Connect / TestFlight 用プロファイル。IPAを作っただけでは端末に直接インストールできません。別途 App Store Connect へアップロードしてください。
- `release-testing`: Ad Hoc 配布用プロファイル。登録済み端末に配布する場合に選択します。

プロファイルに対応する証明書・秘密鍵を使ってください。期限、Team、Bundle ID、配布方式をチェックした上で、一時キーチェーンに取り込み、Archive / IPA Export を実行します。通常終了・ビルド失敗時とも一時鍵とプロファイルを削除します。使い捨てのクラウドランナーを想定しており、証明書付きキャッシュや署名素材を Artifacts に含めません。

Base64 は改行なしで登録します。例えば次のコマンドの出力を Secrets に貼り付けます（出力をチャットやログへ共有しないでください）。

```sh
python3 -c 'import base64,pathlib; print(base64.b64encode(pathlib.Path("certificate.p12").read_bytes()).decode())'
```

## 他のクラウドCIで実行する場合

同じ環境変数を登録して次を実行できます。Android は JDK 21、SDK Platform 36、Build Tools 35.0.0、`ANDROID_HOME` が必要です。iOS は使い捨て macOS / Xcode 26以上のランナーが必要です。

```sh
npm ci
npm run mobile:sync
# BUILD_NUMBER とプラットフォームごとの署名環境変数を設定した状態で
python3 scripts/ci/mobile-release.py android
# macOS上では
python3 scripts/ci/mobile-release.py ios
```

署名情報がない場合は処理を停止し、未署名のファイルを配布成果物として出力しません。クラウドの実行時間・料金は利用するCIサービスの契約に従います。

公式参考: [GitHubのApple証明書設定](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)、[macOSランナーのXcode構成](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md)。

## push時の自動テストビルド

`mobile-release-test.yml` は全ブランチへのpushでAndroidデバッグAPKとiOSシミュレータ用アプリをビルドします。署名付き配布ビルドは引き続きRun workflowから `signed_release` をオンにした場合のみ実行します。`mobile-release` 環境に承認ルールがある場合は、自動ビルドも承認待ちになります。

## AltStore Classicで実機テスト（未署名IPA）

push時と、手動実行で `signed_release` をオフにした時は、iOSシミュレータ用ZIPに加えて **`folio-ios-unsigned.ipa`** を生成します。手動実行は `platform=ios` を選ぶとAndroidビルドを省略できます。Appleの署名Secretsは不要です。

1. GitHub ActionsのiOSジョブが成功したら、Artifactsの `folio-ios-unsigned-and-simulator-<実行番号>` をダウンロードします。
2. ダウンロードしたArtifactのZIPを展開し、`folio-ios-unsigned.ipa` をiPhoneの「ファイル」に保存します。IPA自体は展開しません。
3. セットアップ済みのAltStore ClassicでIPAを選択してインストールします。AltStore側で自分のAppleアカウントを使用して再署名します。署名・更新の条件は利用するAltStoreとAppleアカウントに従います。
4. folioを開き、PDFの読み込み、手書き、保存、終了後の下書き復元を確認してください。

これは実機用 `iphoneos` / arm64 のReleaseビルドで、`Payload/App.app` を格納したIPAです。シミュレータ用ZIPとは別物です。未署名のまま直接インストールしたりApp Storeへ提出したりはできません。

実装: `scripts/ci/build-ios-unsigned.sh`。macOSではWebビルド・`npx cap sync ios` の後に `bash scripts/ci/build-ios-unsigned.sh` で同じIPAを生成できます。実機プラットフォーム、arm64、同梱Web画面、IPAのZIP構造を生成時にチェックします。

この変更のローカル確認は構文・パッケージ処理に限定されます。Xcodeでの実ビルドとAltStore経由のインストールはクラウドと実機で確認してください。

参考: [AltStore Classic公式ガイド](https://faq.altstore.io/altstore-classic/your-altstore)、[AltServer](https://faq.altstore.io/altstore-classic/altserver)。
