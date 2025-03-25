import { TranscriptionService } from '../services/transcription-service';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// 環境変数の読み込み
dotenv.config();

async function testTranscription() {
  try {
    console.log('高精度文字起こしテストを開始します...');
    
    // テスト用の音声/動画ファイルパス（テスト用のファイルを用意してください）
    const testFilePath = process.argv[2];
    
    if (!testFilePath) {
      console.error('テスト用のファイルパスを指定してください。');
      console.error('使用方法: npx ts-node src/tests/transcription-test.ts <ファイルパス>');
      process.exit(1);
    }
    
    if (!fs.existsSync(testFilePath)) {
      console.error(`ファイルが見つかりません: ${testFilePath}`);
      process.exit(1);
    }
    
    console.log(`テスト対象ファイル: ${testFilePath}`);
    
    // TranscriptionServiceのインスタンス化
    const transcriptionService = new TranscriptionService();
    
    console.log('文字起こし処理を開始します...');
    const startTime = Date.now();
    
    // 文字起こし実行
    const transcription = await transcriptionService.transcribeAudio(testFilePath);
    
    const endTime = Date.now();
    const processingTime = (endTime - startTime) / 1000; // 秒単位
    
    console.log('文字起こし処理が完了しました');
    console.log(`処理時間: ${processingTime.toFixed(2)}秒`);
    console.log('\n--- 文字起こし結果 ---\n');
    console.log(transcription);
    console.log('\n--- 文字起こし結果ここまで ---\n');
    
    // 結果をファイルに保存
    const resultDir = path.join(__dirname, '../../test-results');
    fs.mkdirSync(resultDir, { recursive: true });
    
    const resultFilePath = path.join(
      resultDir, 
      `transcription-result-${path.basename(testFilePath)}-${new Date().toISOString().replace(/:/g, '-')}.txt`
    );
    
    fs.writeFileSync(resultFilePath, transcription);
    console.log(`結果を保存しました: ${resultFilePath}`);
    
  } catch (error) {
    console.error('テスト中にエラーが発生しました:', error);
    process.exit(1);
  }
}

testTranscription();
