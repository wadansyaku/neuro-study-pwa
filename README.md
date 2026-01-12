# 神経解剖学 学習Webアプリ（PWA）

このフォルダは **スマホで学習できる簡単なWebアプリ** です（オフライン対応）。
問題データは Postgres に取り込み、クイズ練習と「90分100問」の模擬テストができます。
デッキ切替により、神経解剖と法医学など複数の問題セットを選べます。
新しく spaced repetition（Anki風）と「今日の復習」キュー、誤答理由メモを追加し、学習効率を高めました。

## 使い方（最短）
### 方法A：PCで起動 → スマホでアクセス（おすすめ）
1) このフォルダをPCに置く  
2) ターミナル/コマンドプロンプトでこのフォルダに移動し、以下を実行  
   - Pythonがある場合: `python -m http.server 8000`
3) スマホを同じWi‑Fiに接続  
4) スマホのブラウザで `http://<PCのIPアドレス>:8000` を開く  
5) iPhoneなら共有ボタン →「ホーム画面に追加」  
   Androidならメニュー →「ホーム画面に追加/インストール」  
→ 以降はアプリのように起動できます（Service Workerによりオフライン可）

### 方法B：GitHub Pagesで公開（外出先でもOK）
1) GitHubで新規リポジトリを作成  
2) このフォルダの中身をアップロード  
3) Settings → Pages → Branchをmain / root に設定  
4) 数分後に表示されるURLをスマホで開き「ホーム画面に追加」

### 初期設定（DB利用時）
1) Vercel で `SYNC_TOKEN` を設定する  
2) アプリの「データ」タブで API トークンとユーザーIDを入力する

## 機能
- クイック練習（10問）
- 未学習優先練習（未解答の問題を優先して10問出題）
- トピック/タグ別練習（タグから10問ランダム）
- 模擬テスト（90分・100問、途中保存→再開可）
- 弱点復習（間違いが多い問題＋復習期限を優先）
- 今日の復習（SRのDue優先→新規、最大20問）
- 進捗表示（正答率・間違い上位・理由ランキング・タグ別Due）
- 解答後に Again/Hard/Good/Easy で間隔反復を更新
- 誤答理由（固定候補）と短いメモを記録可能
- 学習履歴のJSON書き出し/読み込み（DB基準）
- 問題データのJSON書き出し（DB）
- デッキ切替（複数の問題セットを選択）
- 短答（穴埋め）問題タイプ

## 注意
- 学習履歴は DB に保存されます。端末を変えても同一ユーザーIDで復元できます。

## デッキ追加方法
1. `data/decks.json` にデッキ定義を追加する  
   例:
   ```json
   [
     {"id":"neuro","label":"神経解剖","path":"./data/questions.json"},
     {"id":"forensics","label":"法医学","path":"./data/questions_forensics_v1.json"}
   ]
   ```
2. `path` で指定した JSON を配置する（相対パス推奨）
3. `npm run seed` で DB に取り込み
4. アプリ起動後、画面上部のデッキ選択で切り替えられます

## 問題データのフォーマット
共通フィールド: `id`, `type`, `type_raw`, `stem`, `answer`, `explanation`, `tag`, `topic`

### single（単一選択）
```json
{
  "id": "Q001",
  "type": "single",
  "type_raw": "単一選択",
  "stem": "...",
  "options": { "A":"...", "B":"..." },
  "answer": ["B"],
  "explanation": "...",
  "tag": "...",
  "topic": "..."
}
```

### short（短答/穴埋め）
```json
{
  "id": "FQ001",
  "type": "short",
  "type_raw": "短答",
  "stem": "【異状死体】医師法21条：何時間以内に届け出？",
  "options": {},
  "answer": ["24", "24時間", "24時間以内"],
  "explanation": "...",
  "tag": "異状死体",
  "topic": "法医学"
}
```

## 進捗データ（v3）と移行
- 進捗は DB に保存されます（DB が唯一の正）。
- 旧 localStorage データは「データ」タブからワンクリックで移行できます。
- エクスポート/インポートは v3 スキーマを含む JSON です。

## デプロイ（Vercel GUIで最短）
ビルド不要の静的ホスティングで動きます。GitHub Pages / Vercel の両方で相対パス動作を確認するため、manifest / SW / decks.json / questions.json の参照は相対URLにしています。

1. GitHubでこのリポジトリを作成（またはFork）する  
2. Vercel ダッシュボード → **Add New… → Project** → Import from GitHub → リポジトリを選択  
3. Framework Preset: **Other**（ビルド不要）、Root Directory: `/`、Build Command: なし（空）、Output: `/` のまま  
4. Deploy を押すと数十秒で `https://<project>.vercel.app/` が発行されます  
5. 初回アクセス時にオンラインで開いてインストール（ホーム画面追加）するとオフラインでも動作します

GitHub Pages での手順は `GITHUB_PAGES_STEPS.md` も参照してください。

## Vercelデプロイ手順（静的配信 + /api Functions）
1. このリポジトリを Vercel に Import  
   - Framework Preset: **Other**  
   - Root Directory: `/`  
   - Build Command: なし / Output: `/`
2. Vercel Postgres を **Add Integration** する（DATABASE_URL / POSTGRES_URL が自動で環境変数に入ります）
3. 環境変数を設定する  
   - `SYNC_TOKEN`: 任意の長い文字列（Bearerトークンとして使用）  
   - `SYNC_ALLOWED_ORIGINS`: CORS許可オリジン（カンマ区切り）。未設定なら同一オリジンのみ許可  
   - Postgres の接続変数（`POSTGRES_URL` など）はIntegrationが自動付与
4. `npm run migrate` と `npm run seed` を実行して DB を準備する
5. 再デプロイすると `/api/health` を含む API が使えます（Service Worker / manifest は vercel.json で no-store ヘッダー）

## DBマイグレーション
新しい DB スキーマは `migrations/` で管理します。ローカルまたはVercelの環境変数（`POSTGRES_URL` など）が設定されている状態で以下を実行します。

```bash
npm run migrate
```

### 問題データの取り込み

```bash
npm run seed
```

設計の詳細は `docs/architecture.md` を参照してください。

### API概要
- `GET /api/health` : 200 / `{ok: true}`  
- `GET /api/decks`  
- `GET /api/questions?deckId=...`  
- `GET /api/review/today` / `weak` / `untouched` / `tag`  
- `POST /api/attempts`  
- `POST /api/test-sessions` / `GET /api/test-sessions?id=...`  
- `GET /api/progress/summary`  
- `POST /api/import/progress` / `GET /api/export/progress`  

※ `/api/state` は旧同期機能として残っています（deprecated）。

### ローカル開発
- 依存インストール: `npm install`
- マイグレーション: `npm run migrate`
- 問題データ投入: `npm run seed`
- Vercel CLI で Functions をローカル実行する場合: `npm run dev`（`vercel` CLI 同梱）  
- 静的ファイルは `python -m http.server 8000` などでも確認できます（APIは別途環境が必要）
