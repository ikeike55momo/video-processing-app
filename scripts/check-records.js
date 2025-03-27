const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('データベースからレコードを取得中...');
    
    const records = await prisma.record.findMany({
      orderBy: {
        created_at: 'desc'
      },
      take: 10
    });
    
    console.log(`${records.length}件のレコードが見つかりました`);
    
    records.forEach((record, index) => {
      console.log(`\n--- レコード ${index + 1} ---`);
      console.log(`ID: ${record.id}`);
      console.log(`ファイルURL: ${record.file_url || record.file_key}`);
      console.log(`ステータス: ${record.status}`);
      console.log(`作成日時: ${record.created_at}`);
      
      if (record.transcript_text) {
        console.log(`文字起こし（先頭200文字）: ${record.transcript_text.substring(0, 200)}...`);
      } else {
        console.log('文字起こし: なし');
      }
      
      if (record.summary_text) {
        console.log(`要約（先頭200文字）: ${record.summary_text.substring(0, 200)}...`);
      } else {
        console.log('要約: なし');
      }
      
      if (record.error) {
        console.log(`エラー: ${record.error}`);
      }
    });
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
