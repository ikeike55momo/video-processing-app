import { PrismaClient, Status } from '@prisma/client';
import { testConfig } from './test-config';
import * as dotenv from 'dotenv';

// 環境変数の読み込み
dotenv.config();

/**
 * テスト用データベースのセットアップ
 */
async function setupTestDatabase() {
  console.log('テスト用データベースのセットアップを開始します...');
  
  const prisma = new PrismaClient();
  
  try {
    // テスト用レコードの作成
    for (const testRecord of testConfig.testRecords) {
      // 既存のレコードを確認
      const existingRecord = await prisma.record.findUnique({
        where: { id: testRecord.id }
      });
      
      if (existingRecord) {
        console.log(`既存のテストレコードを更新します: ${testRecord.id}`);
        await prisma.record.update({
          where: { id: testRecord.id },
          data: {
            file_key: testRecord.file_key,
            status: Status.UPLOADED,
            transcript_text: null,
            summary_text: null,
            article_text: null,
            error: null,
            processing_step: null
          }
        });
      } else {
        console.log(`新しいテストレコードを作成します: ${testRecord.id}`);
        await prisma.record.create({
          data: {
            id: testRecord.id,
            file_key: testRecord.file_key,
            status: Status.UPLOADED
          }
        });
      }
    }
    
    console.log('テスト用データベースのセットアップが完了しました');
    
    // 作成したレコードの確認
    const records = await prisma.record.findMany({
      where: {
        id: {
          in: testConfig.testRecords.map(r => r.id)
        }
      }
    });
    
    console.log('テスト用レコード:');
    console.table(records.map(r => ({
      id: r.id,
      file_key: r.file_key,
      status: r.status
    })));
    
  } catch (error) {
    console.error('テスト用データベースのセットアップ中にエラーが発生しました:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// スクリプトが直接実行された場合のみ実行
if (require.main === module) {
  setupTestDatabase()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { setupTestDatabase };
