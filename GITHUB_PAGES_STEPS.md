# GitHub Pages（方法B）で公開する手順（最短）

## 0) 前提
- `index.html` がリポジトリの **ルート（直下）** にあること
- GitHub Pages の設定で「main / (root)」を選ぶこと

## 1) リポジトリ作成
GitHub → 右上「+」→ **New repository**
- Repository name: 例 `neuro-study-pwa`
- Public（まずはPublic推奨。PrivateはプランによってPagesが使えない場合あり）
- Create repository

## 2) ファイルをアップロード
作成したリポジトリの画面で
- **Add file → Upload files**
- このフォルダ内のファイル（zipを解凍した中身）を **全部** ドラッグ＆ドロップ
  - `index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `sw.js`, `data/`, `icons/`, `.nojekyll` など
- Commit changes

## 3) Pagesを有効化
リポジトリ → **Settings → Pages**
- Build and deployment
  - Source: **Deploy from a branch**
  - Branch: **main**
  - Folder: **/(root)**
- Save

## 4) 公開URLを開く
数十秒〜数分後に
- `https://<ユーザー名>.github.io/<リポジトリ名>/`
が表示されます。

## 5) スマホでアプリ化
iPhone: Safari → 共有 → **ホーム画面に追加**
Android: Chrome → メニュー → **ホーム画面に追加 / インストール**

※オフライン対応（Service Worker）は、最初に1回オンラインで開く必要があります。
