# 神経解剖学 学習Webアプリ（PWA）

このフォルダは **スマホで学習できる簡単なWebアプリ** です（オフライン対応）。
同梱の questions.json（100問）で、クイズ練習と「90分100問」の模擬テストができます。
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
- 学習履歴のJSON書き出し/読み込み（v1→v3へ自動移行）
- 問題データJSONの差し替え（端末内）
- デッキ切替（複数の問題セットを選択）
- 短答（穴埋め）問題タイプ

## 注意
- 学習履歴は端末内に保存されます。端末を変える場合は「学習履歴を書き出す」で移行してください。

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
3. アプリ起動後、画面上部のデッキ選択で切り替えられます

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
- localStorage キー: `neuroStudyProgressV2_<deckId>`（スキーマは v3）
- 旧バージョン（v1）のデータは初回起動時に自動で v3 へ移行します（正答/誤答の累積と最終解答日時を引き継ぎ、SRは今日からスタート）。
- エクスポート/インポートは v3 スキーマを含む JSON です。破損データは読み込み時にエラーメッセージを表示します。

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
4. 再デプロイすると `/api/health`・`/api/state` が使えます（Service Worker / manifest は vercel.json で no-store ヘッダー）

### DBスキーマ（自動作成）
Functions 側で初回アクセス時に `user_state` テーブルを作成します。

```sql
CREATE TABLE IF NOT EXISTS user_state (
  id text PRIMARY KEY,
  state_json jsonb,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

格納するデータは localStorage `neuroStudyProgressV2_<deckId>`（v3スキーマ）をそのまま JSON として保存し、`version` をインクリメントして衝突検知に使います。

### API概要
- `GET /api/health` : 200 / `{ok: true}`  
- `GET /api/state` : `Authorization: Bearer <SYNC_TOKEN>` 必須  
  - レスポンス: `{ state: <json|null>, version: <number|null>, updatedAt: <iso|null> }`
- `PUT /api/state` : `Authorization: Bearer <SYNC_TOKEN>` 必須  
  - リクエスト例: `{ state: <json>, baseVersion: <number|null>, force?: boolean }`  
  - `baseVersion` がクラウド側の `version` と異なる場合、`409 Conflict` + 現在の `{state, version, updatedAt}` を返します  
  - `force: true` で上書き可能（衝突警告はフロント側で表示）

### クラウド同期の使い方（フロント UI）
1. 画面上部「データ」タブ → 「クラウド同期」セクションを開く  
2. **同期トークン** に `SYNC_TOKEN` を入力（マスク保存）。必要なら API ベースURLも設定（空なら同一ドメインの `/api` を使用）  
3. 「設定を保存」→  
   - 「クラウドから取得」: DBの progress v3 を localStorage に復元  
   - 「クラウドへ送信」: localStorage の progress v3 を DB に保存（`baseVersion` 一致を確認）  
   - 衝突時は警告 + 「クラウドを強制上書き」ボタンで明示的に上書き可能
4. 最終同期時刻 / クラウド側の version を表示。同期に失敗しても学習機能はそのまま使えます（オフライン対応）。

### ローカル開発
- 依存インストール: `npm install`
- Vercel CLI で Functions をローカル実行する場合: `npm run dev`（`vercel` CLI 同梱）  
- 静的ファイルは `python -m http.server 8000` などでも確認できます（APIは別途環境が必要）
