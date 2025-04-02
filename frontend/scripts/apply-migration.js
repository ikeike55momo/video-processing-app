#!/usr/bin/env node

/**
 * データベースマイグレーションを適用するスクリプト
 * 
 * 使用方法:
 * node scripts/apply-migration.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 現在の作業ディレクトリを取得
const currentDir = process.cwd();
console.log(`現在の作業ディレクトリ: ${currentDir}`);

// Prismaスキーマのパスを設定
const schemaPath = path.join(currentDir, 'prisma', 'schema.prisma');
console.log(`Prismaスキーマのパス: ${schemaPath}`);

// スキーマファイルの存在確認
if (!fs.existsSync(schemaPath)) {
  console.error(`エラー: Prismaスキーマファイルが見つかりません: ${schemaPath}`);
  process.exit(1);
}

try {
  // 環境変数の確認
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? '設定されています' : '設定されていません');
  console.log('DIRECT_URL:', process.env.DIRECT_URL ? '設定されています' : '設定されていません');

  if (!process.env.DATABASE_URL) {
    console.error('エラー: DATABASE_URL環境変数が設定されていません');
    process.exit(1);
  }

  // Prisma Clientの生成
  console.log('Prisma Clientを生成しています...');
  execSync('npx prisma generate', { 
    stdio: 'inherit',
    env: { ...process.env }
  });

  // マイグレーションの適用
  console.log('マイグレーションを適用しています...');
  execSync('npx prisma migrate deploy', { 
    stdio: 'inherit',
    env: { ...process.env }
  });

  console.log('マイグレーションが正常に適用されました');
} catch (error) {
  console.error('マイグレーション適用中にエラーが発生しました:', error.message);
  process.exit(1);
}
