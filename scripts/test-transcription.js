// Gemini APIを使用した文字起こしのテストスクリプト
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 環境変数を読み込む
dotenv.config();

// Gemini API Keyを取得
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('エラー: GEMINI_API_KEYが設定されていません。.envファイルを確認してください。');
  process.exit(1);
}

// Gemini APIクライアントを初期化
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// FFmpegのパスを設定
const ffmpegPath = ffmpegStatic;
const ffprobePath = ffprobeStatic.path;

console.log(`FFmpeg path: ${ffmpegPath}`);
console.log(`FFprobe path: ${ffprobePath}`);
console.log(`Gemini model: ${MODEL_NAME}`);

// 使用方法のチェック
if (process.argv.length < 3) {
  console.log('使用方法: node test-transcription.js <音声または動画ファイルのパス>');
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
const tempDir = path.join(require('os').tmpdir(), 'transcription-test-' + Date.now());
fs.mkdirSync(tempDir, { recursive: true });

// 文字起こしプロンプト
const TRANSCRIPTION_PROMPT = `
あなたは高精度文字起こしの専門家です。このファイルは実際にユーザーがアップロードした音声または動画データです。

## 文字起こしの指示
1. 全ての言葉を省略せず、一語一句正確に文字起こししてください
2. 専門用語や固有名詞は特に注意して正確に書き起こしてください
3. 話者を識別し、適切にラベル付けしてください（「話者A：」「話者B：」など）
4. 聞き取れない部分は[不明]と記録してください
5. 音声の特徴（笑い、ため息、強調など）も[笑い]のように記録してください
6. 言い間違いや言い直しも忠実に書き起こしてください
7. 句読点、改行を適切に入れて読みやすくしてください

## 最重要指示
- これは実際の文字起こしタスクです。架空の内容を絶対に生成しないでください。
- 「AIスクールセミナー」や「LLMを活用した文字起こし」などの架空のセミナー内容を生成してはいけません。
- 音声に実際に含まれている内容だけを文字起こししてください。
- 音声が聞き取れない場合は「この音声は聞き取れません」と正直に報告してください。
- 音声が存在しない場合は「音声データが検出できません」と報告してください。
- 音声データが不完全または破損している場合は「音声データが不完全または破損しています」と報告してください。
- 架空の内容を生成することは厳禁です。これは実際のユーザーデータの文字起こしです。
- 音声が聞き取れない場合は、架空のセミナー内容を生成せず、「音声が聞き取れません」と報告してください。

## 音声特性
- 複数の話者が存在する可能性があります
- 背景音がある場合があります
- 音質が変化する場合があります

全ての言葉を省略せず、一言一句漏らさず文字起こしして下さい。これは非常に重要な情報であり、完全な正確さが求められます。
`;

// Gemini APIで文字起こしを実行
async function transcribeWithGemini(audioPath) {
  try {
    console.log(`Gemini APIを使用して文字起こしを開始: ${audioPath}`);
    
    // 音声ファイルを読み込み
    const audioData = fs.readFileSync(audioPath);
    
    // Geminiモデルの取得
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    
    // 音声データをBase64エンコード
    const base64Audio = audioData.toString('base64');
    
    // MIMEタイプを設定
    const mimeType = 'audio/wav';
    
    console.log(`使用するMIMEタイプ: ${mimeType}`);
    console.log('Gemini APIにリクエストを送信中...');
    
    // Gemini APIへのリクエスト
    const result = await model.generateContent([
      { text: TRANSCRIPTION_PROMPT },
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Audio
        }
      }
    ]);
    
    const response = result.response;
    const transcription = response.text();
    
    // 架空のセミナー内容が含まれていないか確認
    if (transcription.includes('AIスクール') || 
        transcription.includes('LLMの基礎') || 
        transcription.includes('セミナー要約') ||
        transcription.includes('AIを活用して人生を変えた')) {
      console.warn('警告: 架空のセミナー内容が検出されました。文字起こし結果を破棄します。');
      return '警告: Gemini APIが架空の内容を生成しました。実際の音声データを文字起こしできませんでした。音声データが破損しているか、処理できない形式である可能性があります。';
    }
    
    console.log('文字起こしが完了しました');
    return transcription;
  } catch (error) {
    console.error('Gemini APIでの文字起こし中にエラーが発生しました:', error);
    throw error;
  }
}

// 大きな音声ファイルを分割して処理
async function transcribeChunked(audioPath) {
  try {
    console.log(`音声ファイルを分割して処理します: ${audioPath}`);
    
    // 音声ファイルのメタデータを取得
    const metadataCmd = `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${audioPath}"`;
    const metadataJson = execSync(metadataCmd).toString();
    const metadata = JSON.parse(metadataJson);
    
    // 音声の長さ（秒）
    const duration = parseFloat(metadata.format.duration) || 0;
    console.log(`音声の長さ: ${duration}秒`);
    
    // 分割数を計算（5分ごとに分割）
    const chunkDuration = 300; // 5分 = 300秒
    const chunks = Math.ceil(duration / chunkDuration);
    console.log(`音声を${chunks}チャンクに分割します`);
    
    // 各チャンクを処理
    const transcriptions = [];
    
    for (let i = 0; i < chunks; i++) {
      const start = i * chunkDuration;
      const end = Math.min((i + 1) * chunkDuration, duration);
      console.log(`チャンク${i+1}/${chunks}を処理: ${start}秒 - ${end}秒`);
      
      // チャンクを抽出
      const chunkPath = path.join(tempDir, `chunk-${start}-${end}.wav`);
      const chunkCmd = `"${ffmpegPath}" -i "${audioPath}" -ss ${start} -to ${end} -vn -acodec pcm_s16le -ar 16000 -ac 1 -f wav "${chunkPath}"`;
      
      try {
        execSync(chunkCmd, { stdio: 'inherit' });
        console.log(`チャンク抽出完了: ${chunkPath}`);
        
        // チャンクを処理
        const chunkTranscription = await transcribeWithGemini(chunkPath);
        transcriptions.push(chunkTranscription);
        
        // 一時ファイルを削除
        if (fs.existsSync(chunkPath)) {
          fs.unlinkSync(chunkPath);
          console.log(`チャンク一時ファイルを削除しました: ${chunkPath}`);
        }
      } catch (chunkError) {
        console.error(`チャンク${i+1}の処理中にエラーが発生しました:`, chunkError);
        transcriptions.push(`[チャンク${i+1}の処理中にエラーが発生しました]`);
      }
    }
    
    // 結果を結合
    const combinedTranscription = transcriptions.join('\n\n');
    console.log(`全チャンクの処理が完了しました。結果の長さ: ${combinedTranscription.length}文字`);
    
    return combinedTranscription;
  } catch (error) {
    console.error('チャンク処理中にエラーが発生しました:', error);
    throw error;
  }
}

async function runTest() {
  try {
    console.log('=== 文字起こしテスト ===');
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
      
      // ステップ3: 音声ファイルのサイズに基づいて処理方法を決定
      console.log('\n3. 文字起こし処理を開始します...');
      let transcriptionResult = '';
      
      if (optimizedSizeMB > 4) {
        console.log(`ファイルサイズが大きいため（${optimizedSizeMB.toFixed(2)} MB）、分割処理を行います`);
        transcriptionResult = await transcribeChunked(optimizedPath);
      } else {
        console.log(`ファイルサイズが小さいため（${optimizedSizeMB.toFixed(2)} MB）、直接処理します`);
        transcriptionResult = await transcribeWithGemini(optimizedPath);
      }
      
      // ステップ4: 結果を保存
      console.log('\n4. 文字起こし結果を保存します...');
      const resultPath = path.join(process.cwd(), `transcription-result-${Date.now()}.txt`);
      fs.writeFileSync(resultPath, transcriptionResult);
      console.log(`文字起こし結果を保存しました: ${resultPath}`);
      
      // 結果の一部を表示
      const previewLength = Math.min(500, transcriptionResult.length);
      console.log('\n文字起こし結果のプレビュー:');
      console.log('-----------------------------------');
      console.log(transcriptionResult.substring(0, previewLength) + (transcriptionResult.length > previewLength ? '...' : ''));
      console.log('-----------------------------------');
      
      // クリーンアップ
      console.log('\nテスト完了後のクリーンアップを行います...');
      if (audioPath !== filePath && fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
        console.log(`抽出された音声ファイルを削除しました: ${audioPath}`);
      }
      
      if (fs.existsSync(optimizedPath)) {
        fs.unlinkSync(optimizedPath);
        console.log(`最適化された音声ファイルを削除しました: ${optimizedPath}`);
      }
      
      console.log(`\n=== テスト完了 ===`);
      console.log(`文字起こし結果は ${resultPath} に保存されています`);
      
    } catch (error) {
      console.error('音声最適化または文字起こし中にエラーが発生しました:', error);
    }
  } catch (error) {
    console.error('テスト中にエラーが発生しました:', error);
  }
}

runTest();
