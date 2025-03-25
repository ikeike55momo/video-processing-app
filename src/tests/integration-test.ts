import { PrismaClient, Status, ProcessingStep } from '@prisma/client';
import { ProcessingPipeline } from '../services/processing-pipeline';
import { testConfig } from './test-config';
import { setupTestDatabase } from './setup-test-db';
import { downloadTestAssets } from './download-test-assets';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// 環境変数の読み込み
dotenv.config();

/**
 * 統合テスト - 高精度文字起こしフローのテスト
 */
async function runIntegrationTest() {
  console.log('高精度文字起こしフローの統合テストを開始します...');
  
  // テスト環境のセットアップ
  await downloadTestAssets();
  await setupTestDatabase();
  
  const prisma = new PrismaClient();
  const pipeline = new ProcessingPipeline();
  
  try {
    // テスト対象のレコードID
    const testRecordId = process.argv[2] || 'test-short-audio';
    
    // レコードの存在確認
    const record = await prisma.record.findUnique({
      where: { id: testRecordId }
    });
    
    if (!record) {
      throw new Error(`テスト用レコードが見つかりません: ${testRecordId}`);
    }
    
    console.log(`テスト対象レコード: ${testRecordId}`);
    console.log('レコード情報:', record);
    
    // 処理パイプラインの実行
    console.log('処理パイプラインを開始します...');
    const startTime = Date.now();
    
    await pipeline.process(testRecordId);
    
    const endTime = Date.now();
    const processingTime = (endTime - startTime) / 1000; // 秒単位
    
    // 処理結果の確認
    const updatedRecord = await prisma.record.findUnique({
      where: { id: testRecordId }
    });
    
    console.log('処理が完了しました');
    console.log(`処理時間: ${processingTime.toFixed(2)}秒`);
    
    // 結果の表示
    console.log('\n--- 処理結果 ---');
    console.log(`ステータス: ${updatedRecord?.status}`);
    console.log(`エラー: ${updatedRecord?.error || 'なし'}`);
    
    if (updatedRecord?.transcript_text) {
      console.log('\n--- 文字起こし結果（抜粋） ---');
      console.log(updatedRecord.transcript_text.substring(0, 500) + '...');
      
      // 結果をファイルに保存
      const resultDir = path.resolve(testConfig.testResultsDir);
      fs.mkdirSync(resultDir, { recursive: true });
      
      const resultFilePath = path.join(
        resultDir, 
        `integration-test-${testRecordId}-${new Date().toISOString().replace(/:/g, '-')}.txt`
      );
      
      fs.writeFileSync(resultFilePath, JSON.stringify({
        recordId: testRecordId,
        processingTime: processingTime,
        status: updatedRecord.status,
        error: updatedRecord.error,
        transcript_text: updatedRecord.transcript_text,
        summary_text: updatedRecord.summary_text,
        article_text: updatedRecord.article_text
      }, null, 2));
      
      console.log(`\n結果を保存しました: ${resultFilePath}`);
    }
    
    console.log('\nテストが完了しました');
    
  } catch (error) {
    console.error('テスト中にエラーが発生しました:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// スクリプトが直接実行された場合のみ実行
if (require.main === module) {
  runIntegrationTest()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { runIntegrationTest };
