# 動画処理アプリ Frontend

![Awesome](https://img.shields.io/badge/Awesome-Yes-brightgreen)

## ロゴ
<!-- 必要に応じてロゴ画像をここに挿入 -->

## 概要
動画アップロード・認証・Cloudflare R2連携・Gemini APIを備えたNext.jsフロントエンドです。

---

## なぜ.cursorrules？
本リポジトリはCursor AI/AIコーディング支援のベストプラクティスに基づき、ルールや運用ガイドを明文化しています。

---

## 目次
- [ルール](#ルール)
- [使用方法](#使用方法)
- [貢献](#貢献)
- [ライセンス](#ライセンス)

---

## ルール

### データベースとAPI
- Prisma Clientはサーバーサイドコンポーネントでのみ使用
- Cloudflare R2ストレージ連携
- Gemini APIキー・モデル指定

### 認証・NextAuth
- ローカル開発時は`.env`の`NEXTAUTH_URL`を`http://localhost:3000`に設定
- 本番（Vercel等）では**Vercelの環境変数管理画面で`NEXTAUTH_URL`を本番URL（例: `https://your-app.vercel.app`）に設定**
- `NEXTAUTH_SECRET`は十分に複雑な値を使用し、流出に注意

---

## 使用方法

### ローカル開発
1. `.env`ファイル例：
   ```env
   NEXTAUTH_URL=http://localhost:3000
   NEXTAUTH_SECRET=（適切なランダム値）
   ...（他のキーも必要に応じて記載）
   ```
2. 依存関係インストール
   ```sh
   npm install
   ```
3. 開発サーバー起動
   ```sh
   npm run dev
   ```

### 本番デプロイ（Vercel等）
- **Vercel管理画面で下記環境変数を設定**
  - `NEXTAUTH_URL=https://your-app.vercel.app`
  - `NEXTAUTH_SECRET=（同上）`
- `.env`ファイルには本番URLは記載しないことを推奨

---

## 貢献
プルリクエスト・Issue歓迎です。運用ルールやカテゴリ追加もご提案ください。

---

## ライセンス
MIT
