/**
 * テスト用レコードを手動で作成するスクリプト
 */
const { PrismaClient } = require('@prisma/client');
const path = require('path');
require('dotenv').config();

// テスト用レコードID（コマンドライン引数から取得）
const testRecordId = process.argv[2] || `test-record-${Date.now()}`;
// テスト用ファイルパス（コマンドライン引数から取得）
const testFilePath = process.argv[3] || 'test-assets/sample-audio.mp3';

async function createTestRecord() {
  console.log('テスト用レコードを作成します...');
  
  const prisma = new PrismaClient();
  
  try {
    // レコードの存在確認
    const existingRecord = await prisma.record.findUnique({
      where: { id: testRecordId }
    });
    
    if (existingRecord) {
      console.log(`既存のレコードを更新します: ${testRecordId}`);
      
      const updatedRecord = await prisma.record.update({
        where: { id: testRecordId },
        data: {
          fileUrl: `https://example.com/${testFilePath}`,
          file_key: testFilePath,
          status: 'UPLOADED',
          transcription: null,
          transcriptionStatus: 'PENDING',
          summary: null,
          summaryStatus: 'PENDING',
          article: null,
          articleStatus: 'PENDING',
          errorMessage: null
        }
      });
      
      console.log('レコードを更新しました:', updatedRecord);
    } else {
      console.log(`新しいレコードを作成します: ${testRecordId}`);
      
      const newRecord = await prisma.record.create({
        data: {
          id: testRecordId,
          fileUrl: `https://example.com/${testFilePath}`,
          file_key: testFilePath,
          status: 'UPLOADED'
        }
      });
      
      console.log('レコードを作成しました:', newRecord);
    }
    
    console.log(`\nテスト用レコードID: ${testRecordId}`);
    console.log(`テスト用ファイルパス: ${testFilePath}`);
    console.log('\nこのレコードIDを使用して、以下のコマンドでテストを実行できます:');
    console.log(`npm run start:transcription -- ${testRecordId}`);
    
  } catch (error) {
    console.error('レコード作成中にエラーが発生しました:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// スクリプトの実行
createTestRecord()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  });
