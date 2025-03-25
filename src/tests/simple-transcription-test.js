/**
 * 高精度文字起こし機能の簡易テストスクリプト
 * データベースを使用せずに、直接TranscriptionServiceをテストします
 */
const fs = require('fs');
const path = require('path');
const { TranscriptionService } = require('../services/transcription-service');
require('dotenv').config();

// テスト用ディレクトリ
const TEST_ASSETS_DIR = path.join(__dirname, '../../test-assets');
const TEST_RESULTS_DIR = path.join(__dirname, '../../test-results');

/**
 * 文字起こしテスト実行関数
 */
async function runTranscriptionTest() {
  console.log('=== 高精度文字起こし機能の簡易テストを開始します ===');
  
  // テスト用ファイルパスの取得
  const testFilePath = process.argv[2];
  
  if (!testFilePath) {
    console.error('テスト用のファイルパスを指定してください。');
    console.error('使用方法: node src/tests/simple-transcription-test.js <ファイルパス>');
    process.exit(1);
  }
  
  const absoluteFilePath = path.resolve(testFilePath);
  
  if (!fs.existsSync(absoluteFilePath)) {
    console.error(`ファイルが見つかりません: ${absoluteFilePath}`);
    process.exit(1);
  }
  
  console.log(`テスト対象ファイル: ${absoluteFilePath}`);
  
  try {
    // TranscriptionServiceのインスタンス化
    const transcriptionService = new TranscriptionService();
    
    console.log('文字起こし処理を開始します...');
    const startTime = Date.now();
    
    // 文字起こし実行
    const transcription = await transcriptionService.transcribeAudio(absoluteFilePath);
    
    const endTime = Date.now();
    const processingTime = (endTime - startTime) / 1000; // 秒単位
    
    console.log('文字起こし処理が完了しました');
    console.log(`処理時間: ${processingTime.toFixed(2)}秒`);
    console.log('\n--- 文字起こし結果 ---\n');
    console.log(transcription);
    console.log('\n--- 文字起こし結果ここまで ---\n');
    
    // 結果をファイルに保存
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
    
    const resultFilePath = path.join(
      TEST_RESULTS_DIR, 
      `transcription-result-${path.basename(absoluteFilePath)}-${new Date().toISOString().replace(/:/g, '-')}.txt`
    );
    
    fs.writeFileSync(resultFilePath, transcription);
    console.log(`結果を保存しました: ${resultFilePath}`);
    
  } catch (error) {
    console.error('テスト中にエラーが発生しました:', error);
    process.exit(1);
  }
}

// スクリプトの実行
runTranscriptionTest()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  });
