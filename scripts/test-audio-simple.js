// 音声最適化のシンプルなテストスクリプト
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

// FFmpegのパスを設定
const ffmpegPath = ffmpegStatic;
const ffprobePath = ffprobeStatic.path;

console.log(`FFmpeg path: ${ffmpegPath}`);
console.log(`FFprobe path: ${ffprobePath}`);

// 使用方法のチェック
if (process.argv.length < 3) {
  console.log('使用方法: node test-audio-simple.js <音声または動画ファイルのパス>');
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

// 一時ディレクトリを作成
const tempDir = path.join(require('os').tmpdir(), 'audio-test-' + Date.now());
fs.mkdirSync(tempDir, { recursive: true });

async function runTest() {
  try {
    console.log('=== 音声最適化のシンプルテスト ===');
    console.log(`テスト対象ファイル: ${filePath}`);
    
    // ステップ1: 動画の場合は音声を抽出
    let audioPath = filePath;
    const fileExt = path.extname(filePath).toLowerCase();
    const videoFormats = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    
    if (videoFormats.includes(fileExt)) {
      console.log('\n1. 動画から音声を抽出します...');
      const outputPath = path.join(tempDir, `audio-${Date.now()}.mp3`);
      
      // FFmpegを使用して音声を抽出
      const ffmpegCmd = `"${ffmpegPath}" -i "${filePath}" -vn -acodec libmp3lame -ab 128k -ar 44100 -ac 2 "${outputPath}"`;
      console.log(`実行コマンド: ${ffmpegCmd}`);
      
      try {
        execSync(ffmpegCmd, { stdio: 'inherit' });
        audioPath = outputPath;
        
        // 抽出された音声ファイルのサイズを表示
        const audioStats = fs.statSync(audioPath);
        const audioSizeMB = audioStats.size / (1024 * 1024);
        console.log(`抽出された音声ファイルのサイズ: ${audioSizeMB.toFixed(2)} MB`);
      } catch (error) {
        console.error('音声抽出中にエラーが発生しました:', error);
        console.log('音声抽出をスキップして元のファイルを使用します');
      }
    } else {
      console.log('\n1. 入力ファイルは既に音声ファイルです。抽出をスキップします。');
    }
    
    // ステップ2: 音声ファイルの最適化
    console.log('\n2. 音声ファイルを最適化します...');
    const optimizedPath = path.join(tempDir, `optimized-${Date.now()}.wav`);
    
    // FFmpegを使用して最適化
    const optimizeCmd = `"${ffmpegPath}" -i "${audioPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 -f wav "${optimizedPath}"`;
    console.log(`実行コマンド: ${optimizeCmd}`);
    
    try {
      execSync(optimizeCmd, { stdio: 'inherit' });
      
      // 最適化された音声ファイルのサイズを表示
      const optimizedStats = fs.statSync(optimizedPath);
      const optimizedSizeMB = optimizedStats.size / (1024 * 1024);
      console.log(`最適化された音声ファイルのサイズ: ${optimizedSizeMB.toFixed(2)} MB`);
    } catch (error) {
      console.error('音声最適化中にエラーが発生しました:', error);
      console.log('最適化をスキップします');
    }
    
    // ステップ3: 音声ファイルのメタデータを取得
    console.log('\n3. 音声ファイルのメタデータを取得します...');
    const metadataCmd = `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${optimizedPath}"`;
    
    try {
      const metadataJson = execSync(metadataCmd).toString();
      const metadata = JSON.parse(metadataJson);
      
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
      const duration = parseFloat(metadata.format.duration) || 0;
      const chunkDuration = 300; // 5分 = 300秒
      const chunks = Math.ceil(duration / chunkDuration);
      console.log(`音声の長さ: ${duration.toFixed(2)}秒`);
      console.log(`分割数: ${chunks}チャンク`);
      
      for (let i = 0; i < chunks; i++) {
        const start = i * chunkDuration;
        const end = Math.min((i + 1) * chunkDuration, duration);
        console.log(`チャンク${i+1}/${chunks}: ${start.toFixed(2)}秒 - ${end.toFixed(2)}秒`);
        
        // 実際のチャンク抽出（テスト用に1つだけ実行）
        if (i === 0) {
          const chunkPath = path.join(tempDir, `chunk-${start}-${end}.wav`);
          const chunkCmd = `"${ffmpegPath}" -i "${optimizedPath}" -ss ${start} -to ${end} -vn -acodec pcm_s16le -ar 16000 -ac 1 -f wav "${chunkPath}"`;
          console.log(`チャンク抽出コマンド: ${chunkCmd}`);
          
          try {
            execSync(chunkCmd, { stdio: 'inherit' });
            console.log(`チャンク抽出完了: ${chunkPath}`);
            
            // チャンクのサイズを表示
            const chunkStats = fs.statSync(chunkPath);
            const chunkSizeMB = chunkStats.size / (1024 * 1024);
            console.log(`チャンクのサイズ: ${chunkSizeMB.toFixed(2)} MB`);
          } catch (error) {
            console.error('チャンク抽出中にエラーが発生しました:', error);
          }
        }
      }
    } catch (error) {
      console.error('メタデータ取得中にエラーが発生しました:', error);
    }
    
    console.log('\n=== テスト完了 ===');
    console.log(`テスト結果ファイルは ${tempDir} に保存されています`);
    
  } catch (error) {
    console.error('テスト中にエラーが発生しました:', error);
  }
}

runTest();
