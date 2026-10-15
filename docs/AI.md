# Folio AI連携 v1.1（単一ユーザーのデモ）

## 利用者の操作

PDFを開いて「このPDFに質問」を選び、デモのアクセスコードでログインします。対象ページを指定して本文を抽出し、本文・質問・送信する履歴を確認して送信します。通常画面にはGateway URL、ポート、APIキー、モデル選択は表示しません。

標準モデルは **GPT-6 Luna** です。モデル設定はバックエンドの開発者設定だけに残し、利用者による変更・自動変更・有料APIへのフォールバックは行いません。初期値をLunaにしていますが、利用枠消費量や節約率は未検証で、残量も推測表示しません。Gateway経由のCodex認証利用について、利用枠への計上や許諾・契約上の扱いは別途確認が必要です。

## 構成

```text
Folio（iPhone / PC）
  → HTTPS + Folioの短期セッション
  → 既存Expressバックエンド
  → ループバックのCLIProxyAPI
  → GPT-6 Luna
```

Gatewayキーはバックエンドだけが保持します。Folioのログインには別のデモ用アクセスコードを使い、ログイン成功後はランダムな短期Bearerセッションを利用します。これはGatewayキーではありません。セッションは端末のメモリだけに保持し、画面移動中は維持しますが、アプリ再起動・ページ再読み込み後は再ログインします。第三者Cookieに依存しないため、CapacitorのWebViewでも同じ方式を使えます。

iPhoneのlocalhostはWindows／WSL2を指しません。ネイティブ版では開発者がビルド時にHTTPSのFolioバックエンドURLを指定します。未設定・HTTP・localhost指定の配布アプリではAIを安全に無効化します。Web版の製品ビルドもHTTPSを要求し、開発サーバーでのPCローカルHTTPだけを明示的な例外にしています。

## バックエンド設定（開発者向け）

Node.js 24を推奨します。OSの非公開環境変数、または **`.private/ai.env`** を使用します。後者はExpressが読み込み、Viteのenvファイルとして扱いません。既存のプロセス環境変数を優先します。

```sh
mkdir -p .private
chmod 700 .private
cp server/ai.env.example .private/ai.env
chmod 600 .private/ai.env
```

| 設定                         | 用途                                                           |
| ---------------------------- | -------------------------------------------------------------- |
| `FOLIO_AI_GATEWAY_URL`       | バックエンドから見たGateway。初期値 `http://127.0.0.1:8317/v1` |
| `FOLIO_AI_GATEWAY_KEY`       | GatewayローカルAPIキー。非公開・必須                           |
| `FOLIO_AI_MODEL`             | 標準は `gpt-6-luna`。通常は変更しない                          |
| `FOLIO_AI_DEMO_PASSWORD`     | Gatewayキーとは別の24文字以上のランダムなアクセスコード        |
| `FOLIO_AI_ALLOW_LOCAL_HTTP`  | 開発時のループバックHTTPだけを許可。productionでは無効         |
| `FOLIO_AI_REMOTE_ENABLED`    | 外部端末用HTTPS接続の明示的な有効化。初期値false               |
| `FOLIO_AI_KEY_ROTATED`       | 公開済みテストキーの更新と旧キー拒否を確認した場合のみtrue     |
| `FOLIO_AI_PUBLIC_ORIGIN`     | HTTPSの公開先origin。パスや末尾スラッシュを含めない            |
| `FOLIO_AI_TRUST_LOCAL_PROXY` | Tailscale Serveなど同一ホストのHTTPS終端を信頼する場合のみtrue |

`.private/`はGit・Dockerビルド・提出ソースZIPから除外します。Viteの開発サーバーでも`server.fs.deny`でフォルダ全体を拒否し、通常URL・raw・ファイル参照経路から設定ファイルを取得できないようにしています。配信拒否の確認後、デモ用のGatewayキーとアクセスコードを再更新しています。APIキーやアクセスコードをViteの`VITE_*`変数、配布アプリ、ソース、GitHub Secretsを含むフロントビルド設定へ移さないでください。GatewayキーはAPIレスポンスにも返しません。

今回の作業環境には`.private/ai.env`と`.private/gateway-local-test.yaml`を準備しました。後者は既存Gateway設定から認証情報の参照先を引き継いだ非公開コピーです。ループバック専用にし、Gatewayの再試行・上限時のプロジェクト切り替え・モデル切り替え・追加クレジット利用を無効化し、試す認証候補も1件に制限しました。Gatewayのバージョンや認証単位の上書き設定は別途確認が必要です。キーを更新して旧キー401／新キー200を確認済みです。**元の`~/CLIProxyAPI/config.yaml`は変更していないため、元設定で起動し直すとこの更新は反映されません。デモでは更新済みコピーを使用してください。** `.private`一式はこの作業環境だけに存在し、Gitからの新規取得では各開発者が準備します。

この作業環境での起動例：

```sh
~/CLIProxyAPI/cli-proxy-api -config "$PWD/.private/gateway-local-test.yaml"
# 別ターミナル
npm ci
npm run dev
```

PCで `http://localhost:5173` を開きます。一般ユーザーがGateway設定を入力する必要はありません。PDFの閲覧・編集にはAI設定自体が不要です。

## iPhoneからの接続準備

1. WindowsとiPhoneを利用者自身のTailnetに接続し、ACL／Grantsで利用者・端末を限定します。
2. Gatewayはループバックだけで待ち受けます。**8317番ポートを直接公開しません。** 既存の公開済みキーを更新し、旧キーの拒否とバックエンドの新キーを確認します。
3. Folioをビルドし、Expressを127.0.0.1:3001で起動します。ServeをWindows側で動かす場合は、WindowsからWSL2の3001番へ到達することを先に確認します。転送元がループバックとして扱われない構成ではWSL2内でServeを実行してください。すべてのIPからの転送ヘッダーを信頼する設定には変更しません。
4. Tailscale Serveで **Folioの3001番だけ** をHTTPSで提供します。Funnelは使いません。

```sh
npm run build
NODE_ENV=production npm start
# Serveを動かすホストからFolioの3001へ到達できることを確認して実行
# Windowsでは環境変数設定にPowerShell等の対応構文を使います。
tailscale serve --bg http://127.0.0.1:3001
```

5. Serveが表示したHTTPS originを`FOLIO_AI_PUBLIC_ORIGIN`に設定します。`FOLIO_AI_TRUST_LOCAL_PROXY=true`、`FOLIO_AI_KEY_ROTATED=true`を確認したうえで`FOLIO_AI_REMOTE_ENABLED=true`にしてExpressを再起動します。URL・HTTPS・更新確認・十分な長さの認証情報が揃わなければ、外部接続は失敗する設計です。
6. まずiPhone SafariでHTTPSのFolioを開き、アクセスコードでログインします。続いてネイティブ版を使う場合は、GitHubのRepository Variablesに **`VITE_FOLIO_BACKEND_URL=https://<Serveのホスト名>`** だけを登録してビルドします。このURLは秘密情報ではありません。通常画面に設定欄はありません。HTTPやlocalhostのURLは受け付けません。
7. iPhoneからPDF本文を送信して回答と履歴保存を確認します。単なる接続表示の成功と、実際のLuna回答を区別してください。

Serveからの`X-Forwarded-Proto: https`とHostまたは`X-Forwarded-Host`は、設定で許可した**ループバック上のプロキシから来た場合だけ**信頼します。全プロキシを無条件に信頼する設定にはしていません。Tailscaleの利用者ヘッダーをアプリの認証代わりには使いません。

外部アクセスにはHTTPS・許可origin・Folioセッションが必要です。Capacitorの`capacitor://localhost`／`https://localhost`を許可する場合も、通信先は設定した別端末のHTTPSサーバーです。CORSに認証を任せず、全AI操作でセッションを検証します。

## アクセス制限と診断

- ログイン失敗は全体で5回／15分まで。再送信は手動のみです。
- セッションは1時間、最大32件、バックエンド再起動で失効します。
- AI操作はセッションあたり10回／分、同時処理は全体で2件までです。これはFolio側の制限で、Codex利用枠の推測値ではありません。
- 許可しないorigin、平文の外部通信、未更新キー、セッションなし、クライアントからのGateway設定上書きを拒否します。

バックエンドは`folio_ai`というJSONログを標準出力へ出します。記録はrequestId、操作、HTTP状態、分類コード、アクセス判定理由、所要時間だけです。PDF本文・質問・回答・キー・アクセスコード・セッショントークン・生の通信例外は記録しません。

| 状態                                                   | 確認先                                               |
| ------------------------------------------------------ | ---------------------------------------------------- |
| サーバーログが出ない                                   | iPhoneのTailnet接続、DNS、Serveの転送先、TLS証明書   |
| `remote_disabled` / `rotation_required`                | 外部接続フラグ・キー更新確認                         |
| `https_required` / `host_denied` / `proxy_not_trusted` | HTTPS終端、転送ヘッダー、公開origin                  |
| `origin_denied`                                        | Safariのorigin、Capacitorのorigin、接続先の不一致    |
| `session` / `login_limit`                              | デモ認証、セッション期限、ログイン試行制限           |
| `authentication`                                       | バックエンドのGatewayキーとGatewayの認証設定         |
| `unavailable` / `timeout`                              | バックエンドからGatewayへの到達性、Gatewayの状態     |
| `limit` / `request_limit`                              | Gatewayの上限またはFolioの送信制限。自動再試行しない |

クライアント側の失敗ログは`Folio AI`、分類コード、サーバーから取得できたrequestIdだけです。iPhoneのSafari Web Inspector等で確認し、同じrequestIdのサーバーログと照合します。CORS／TLS等で応答自体が読めなければrequestIdはnullです。

## 資料と会話の保存

PDF本体・注釈・編集下書きは端末内のIndexedDBを維持します。AI送信時だけ、指定したPDF本文・質問・利用者が選んだ会話履歴を一時的にバックエンドへ送信します。Expressは資料本文をファイル・DB・ログへ永続保存しません。Gateway側の記録方針は別途管理してください。資料の自動同期は行いません。

本文は連続最大5ページ・12,000文字、質問は3,000文字、履歴と指示を含む全体は24,000文字までです。超過時は切り捨てず停止します。画像だけのページはOCR未対応として停止します。手書き・画像・テキストメモの解析は行いません。

会話は端末内の`folio-pdf` / `aiConversations`へ、資料ID・モデル・質問・回答・参照本文・範囲・時刻とともに保存します。PDF削除では会話も削除し、複製先は会話を引き継ぎません。設定・認証情報・短期セッションは会話に保存しません。AIによる元PDF・注釈の変更は行いません。

利用上限・通信結果不明・タイムアウト・キャンセルでも自動再試行しません。Gatewayで開始済みの推論や利用枠消費の取り消し、アカウントの課金設定・請求額はアプリでは保証できません。課金設定変更・クレジット購入機能はありません。

## 検証状況（2026-10-15）

| 環境                                     | 結果                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| WSL2 → CLIProxyAPI                       | 実キーでモデル一覧取得とLunaの実回答を確認                               |
| WSL2のFolio認証 → バックエンド → Gateway | サンプルPDF本文の科目コードを含むLuna回答を確認                          |
| Windows上のブラウザ → Folio              | 実Windowsブラウザでは未検証。LinuxのPlaywrightで代替検証                 |
| iPhone → 認証付きHTTPSバックエンド       | 実機・Tailnet経由は未検証。HTTPSプロキシ／Origin／認証の自動テストで代替 |
| iPhoneのPDF → Luna回答                   | 実機では未検証                                                           |
| 更新済みデモGatewayキー                  | 旧キー401、新キー200を確認。元のGateway設定は未変更                      |

この環境ではTailscaleコマンドが利用できないため、Tailnetの接続やServe設定は実施していません。外部接続フラグはfalseのままです。自動テストの結果をiPhone実機での成功と扱いません。

公式資料：[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)、[Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)。

### 自動検証

`npm test`は実際の秘密設定を読み込まず、ローカルの模擬Gatewayで認証・HTTPS条件・制限・エラーを検証します。ブラウザテストも専用の模擬GatewayとExpress中継を起動し、実アカウントへ推論を送りません。

```sh
npm test
npm run build
npm run format:check
# npm run devを起動した別ターミナルで
npx playwright test --workers=1
```

通常WebビルドとHTTPSバックエンド指定の配布用Webビルドについて、実Gatewayキー・デモのアクセスコード・ローカルGateway URLが含まれないことも確認しています。Android / iOSのネイティブコンパイル・署名・実機操作は今回未実施です。

自動検証の最終結果：単体24ケース成功、ブラウザ34ケース成功（全体33ケース＋非公開ファイル配信拒否1ケース）。通常Webビルド・HTTPSバックエンド指定のWebバンドル・formatチェックが成功しました。ビルド時には既存の大きなチャンクに関する警告があります。
