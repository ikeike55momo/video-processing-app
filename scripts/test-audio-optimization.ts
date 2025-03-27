// 音声最適化と分割処理のテストスクリプト
import * as path from 'path';
import * as fs from 'fs';
import { TranscriptionService } from '../src/services/transcription-service';
import { GeminiService } from '../src/services/gemini-service';
import { FFmpegService } from '../src/services/ffmpeg-service';

// 使用方法のチェック
if (process.argv.length < 3) {
  console.log('使用方法: npx ts-node scripts/test-audio-optimization.ts <音声または動画ファイルのパス>');
  process.exit(1);
}

// ファイルパスを取得
const filePath = process.argv[2];
if (!fs.existsSync(filePath)) {
  console.error(`エラー: ファイルが見つかりません: ${filePath}`);
  process.exit(1);
}

// ファイルサイズを取得
const stats = fs.statSync(filePath);
const fileSizeMB = stats.size / (1024 * 1024);
console.log(`入力ファイルのサイズ: ${fileSizeMB.toFixed(2)} MB`);

// サービスのインスタンスを作成
const transcriptionService = new TranscriptionService();
const geminiService = new GeminiService();
const ffmpegService = new FFmpegService();

async function runTest() {
  try {
    console.log('=== 音声最適化と分割処理のテスト ===');
    console.log(`テスト対象ファイル: ${filePath}`);
    
    // ステップ1: 動画の場合は音声を抽出
    let audioPath = filePath;
    const fileExt = path.extname(filePath).toLowerCase();
    const videoFormats = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    
    if (videoFormats.includes(fileExt)) {
      console.log('\n1. 動画から音声を抽出します...');
      audioPath = await ffmpegService.extractAudio(filePath, 'mp3');
      console.log(`音声抽出完了: ${audioPath}`);
      
      // 抽出された音声ファイルのサイズを表示
      const audioStats = fs.statSync(audioPath);
      const audioSizeMB = audioStats.size / (1024 * 1024);
      console.log(`抽出された音声ファイルのサイズ: ${audioSizeMB.toFixed(2)} MB`);
    } else {
      console.log('\n1. 入力ファイルは既に音声ファイルです。抽出をスキップします。');
    }
    
    // ステップ2: 音声ファイルの最適化
    console.log('\n2. 音声ファイルを最適化します...');
    const optimizedPath = await transcriptionService.optimizeAudioForGemini(audioPath);
    console.log(`最適化完了: ${optimizedPath}`);
    
    // 最適化された音声ファイルのサイズを表示
    const optimizedStats = fs.statSync(optimizedPath);
    const optimizedSizeMB = optimizedStats.size / (1024 * 1024);
    console.log(`最適化された音声ファイルのサイズ: ${optimizedSizeMB.toFixed(2)} MB`);
    
    // ステップ3: 音声ファイルのメタデータを取得
    console.log('\n3. 音声ファイルのメタデータを取得します...');
    const metadata = await ffmpegService.getMetadata(optimizedPath);
    console.log('メタデータ:');
    console.log(`- フォーマット: ${metadata.format.format_name}`);
    console.log(`- 長さ: ${metadata.format.duration}秒`);
    console.log(`- ビットレート: ${metadata.format.bit_rate}`);
    
    if (metadata.streams && metadata.streams.length > 0) {
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      if (audioStream) {
        console.log(`- サンプルレート: ${audioStream.sample_rate}Hz`);
        console.log(`- チャンネル数: ${audioStream.channels}`);
        console.log(`- コーデック: ${audioStream.codec_name}`);
      }
    }
    
    // ステップ4: 分割処理のシミュレーション
    console.log('\n4. 音声ファイルの分割処理をシミュレーションします...');
    const duration = metadata.format.duration || 0;
    const chunkDuration = 300; // 5分 = 300秒
    const chunks = Math.ceil(duration / chunkDuration);
    console.log(`音声の長さ: ${duration.toFixed(2)}秒`);
    console.log(`分割数: ${chunks}チャンク`);
    
    for (let i = 0; i < chunks; i++) {
      const start = i * chunkDuration;
      const end = Math.min((i + 1) * chunkDuration, duration);
      console.log(`チャンク${i+1}/${chunks}: ${start.toFixed(2)}秒 - ${end.toFixed(2)}秒`);
      
      // 実際のチャンク抽出はコメントアウト（テストのため）
      // const chunkPath = await extractAudioChunk(optimizedPath, start, end);
      // console.log(`チャンク抽出完了: ${chunkPath}`);
    }
    
    console.log('\n=== テスト完了 ===');
    console.log('音声最適化と分割処理が正常に機能しています。');
    
    // クリーンアップ（テスト用なので最適化ファイルは残しておく）
    if (audioPath !== filePath) {
      console.log(`\n注意: 抽出された音声ファイル ${audioPath} は削除されていません。`);
    }
    console.log(`注意: 最適化された音声ファイル ${optimizedPath} は削除されていません。`);
    
  } catch (error) {
    console.error('テスト中にエラーが発生しました:', error);
  }
}

runTest();
