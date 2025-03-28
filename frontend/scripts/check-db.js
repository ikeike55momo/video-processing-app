// データベースの状態を確認するスクリプト
const { PrismaClient } = require('@prisma/client');

// 環境変数から接続情報を取得
require('dotenv').config({ path: '.env.local' });

// データベース接続情報を設定
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/video_processing_db"
    }
  }
});

async function main() {
  try {
    console.log('データベースからレコードを取得中...');
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
