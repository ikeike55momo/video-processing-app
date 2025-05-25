# Video Processing Application

Render + Cloudflare R2を活用した動画処理アプリケーション。Google Cloud環境からの移行プロジェクト。

## 概要

このアプリケーションは、アップロードされた動画ファイルを処理し、以下の機能を提供します：

1. 動画からの文字起こし（Gemini API）
2. 文字起こしテキストの要約（Gemini API）
3. 要約と文字起こしからの記事生成（Claude API）

## アーキテクチャ

```
[フロントエンド] → [Render Web Service] → [Redis Queue] → [Render Background Workers]
                      ↑   ↓                                    ↑   ↓
                      ↑   ↓                                    ↑   ↓
                   [Cloudflare R2] ←----------------------------↓
                                                                ↓
                   [Gemini API / Claude API] ←------------------↓
```

## 技術スタック

- **バックエンド**: Node.js + Express
- **キュー処理**: Redis
- **ストレージ**: Cloudflare R2
- **データベース**: PostgreSQL
- **ホスティング**: Render
- **AI APIs**: Gemini API（Google）、Claude API（Anthropic）

## 環境構築

### 前提条件

- Node.js 16以上
- Redis
- PostgreSQL
- FFmpeg（動画処理用）

### インストール

```bash
# 依存関係のインストール
npm install

# Prismaクライアントの生成
npm run prisma:generate

# データベースマイグレーション
npm run prisma:migrate
```

### 環境変数の設定

`.env.example`ファイルを参考に、`.env`ファイルを作成します。

### 開発用起動

```bash
# APIサーバー
npm run dev

# 文字起こしワーカー
npm run start:transcription

# 要約ワーカー
npm run start:summary

# 記事生成ワーカー
npm run start:article
```

## デプロイ

このプロジェクトはRenderにデプロイすることを想定しています。
`render.yaml`ファイルに定義されたサービス設定を使用することで、
Renderのブループリント機能からワンクリックでデプロイ可能です。

### 必要な環境変数（Render設定）

- `DATABASE_URL`: PostgreSQLデータベースURL
- `REDIS_URL`: RedisインスタンスURL
- `R2_ENDPOINT`: Cloudflare R2エンドポイント
- `R2_ACCESS_KEY_ID`: Cloudflare R2アクセスキーID
- `R2_SECRET_ACCESS_KEY`: Cloudflare R2シークレットキー
- `R2_BUCKET_NAME`: Cloudflare R2バケット名
- `GEMINI_API_KEY`: Google Gemini API キー
- `OPENROUTER_API_KEY`: OpenRouter API キー（Claude APIアクセス用）

## コントリビューション

プルリクエストを歓迎します。大きな変更を加える場合は、まずIssueで議論してください。

## ライセンス

[ISC](LICENSE)
