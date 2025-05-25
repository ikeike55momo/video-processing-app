// 本番環境のデータベースを確認するスクリプト
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

// 本番環境のデータベース接続情報
// 注意: 実際の本番環境の接続情報を入力する必要があります
const prodDatabaseUrl = process.env.PROD_DATABASE_URL || "ここに本番環境のデータベースURLを入力してください";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: prodDatabaseUrl
    }
  }
});

async function main() {
  try {
    console.log('本番環境のデータベースからレコードを取得中...');
    console.log('接続URL:', prodDatabaseUrl.replace(/\/\/(.+?):.+?@/, '//***:***@')); // パスワードを隠す
    
    const records = await prisma.record.findMany();
    
    console.log(`合計 ${records.length} 件のレコードが見つかりました`);
    
    // レコードの詳細を表示
    records.forEach((record, index) => {
      console.log(`\n--- レコード ${index + 1} ---`);
      console.log(`ID: ${record.id}`);
      console.log(`ファイルURL: ${record.file_url}`);
      console.log(`ステータス: ${record.status}`);
      console.log(`作成日時: ${record.created_at}`);
      
      // タイムスタンプの確認
      if (record.timestamps_json) {
        console.log('タイムスタンプ: あり');
        try {
          const timestamps = JSON.parse(record.timestamps_json);
          console.log(`タイムスタンプ数: ${timestamps.timestamps ? timestamps.timestamps.length : 0}`);
        } catch (e) {
          console.log('タイムスタンプの解析に失敗:', e.message);
          console.log('タイムスタンプJSON内容:', record.timestamps_json);
        }
      } else {
        console.log('タイムスタンプ: なし');
      }
      
      // サマリーテキストの確認
      if (record.summary_text) {
        console.log('サマリーテキスト: あり');
        console.log('サマリーテキスト内容（先頭100文字）:', record.summary_text.substring(0, 100) + '...');
        
        // サマリーテキストにタイムスタンプデータが含まれているか確認
        if (record.summary_text.includes('"timestamps"')) {
          console.log('サマリーテキストにタイムスタンプデータが含まれています');
          try {
            const data = JSON.parse(record.summary_text);
            if (data.timestamps) {
              console.log(`サマリーテキスト内のタイムスタンプ数: ${data.timestamps.length}`);
            }
          } catch (e) {
            console.log('サマリーテキスト内のタイムスタンプの解析に失敗:', e.message);
          }
        }
      } else {
        console.log('サマリーテキスト: なし');
      }
    });
  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
