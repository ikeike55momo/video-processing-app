'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios').default;
const { pipeline } = require('stream/promises');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// 高精度文字起こしサービスクラス
// Gemini Flashを使用して高精度な文字起こしを実現
class TranscriptionService {
  constructor() {
    // Gemini APIの初期化
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY環境変数が設定されていません');
    }
    this.genAI = new GoogleGenerativeAI(geminiApiKey);
    
    // 環境変数からモデル名を取得（デフォルトはgemini-2.0-flash）
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    
    // S3クライアントの初期化（Cloudflare R2用）
    this.s3Client = new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    });
    
    console.log('TranscriptionServiceを初期化しました');
  }

  // 音声ファイルを文字起こし（フォールバックメカニズム付き）
  async transcribeAudio(audioPath) {
    console.log(`文字起こし処理を開始: ${audioPath}`);
    console.log(`ファイル情報: 存在=${fs.existsSync(audioPath)}, サイズ=${fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 'N/A'} バイト`);
    
    try {
      // 音声ファイルを最適化（すべての処理フローで共通）
      console.log(`音声ファイルの最適化を開始します...`);
      const optimizedAudioPath = await this.optimizeAudioForGemini(audioPath);
      
      // ファイルサイズを確認
      const fileSize = fs.statSync(optimizedAudioPath).size;
      console.log(`最適化後のファイルサイズ: ${fileSize} バイト`);
      
      // 大きなファイルの場合は分割処理
      if (fileSize > 4 * 1024 * 1024) { // 4MB以上
        console.log(`ファイルサイズが大きいため、分割処理を行います: ${fileSize} バイト`);
        return await this.transcribeLargeAudio(optimizedAudioPath);
      } else {
        // 小さなファイルは直接処理
        console.log(`ファイルサイズが小さいため、直接処理を行います: ${fileSize} バイト`);
        return await this.transcribeWithGemini(optimizedAudioPath);
      }
    } catch (error) {
      console.error(`文字起こし処理中にエラーが発生しました:`, error);
      throw error;
    }
  }

  // 文字起こしテキストからタイムスタンプを抽出
  async extractTimestamps(transcription, audioPath) {
    console.log(`タイムスタンプ抽出処理を開始: テキスト長=${transcription.length}文字`);
    
    try {
      // 音声ファイルをバイナリデータとして読み込み
      const audioData = fs.readFileSync(audioPath);
      
      // Geminiモデルの初期化
      const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
      
      // プロンプトの設定
      const prompt = `
以下は音声の文字起こしテキストです。この音声データを分析し、主要なポイントごとにタイムスタンプを抽出してください。

## 指示
1. 音声の内容を分析し、重要なトピックの変わり目や主要なポイントを特定してください
2. 各ポイントの開始時間（秒単位）とその内容の要約を抽出してください
3. 結果は以下のJSON形式で返してください:

\`\`\`json
{
  "timestamps": [
    {
      "time": 0,
      "text": "導入部分の内容"
    },
    {
      "time": 120,
      "text": "次のトピックの内容"
    },
    ...
  ]
}
\`\`\`

## 重要な注意点
- 時間は秒単位の数値で指定してください（例: 65.5）
- 各ポイントの要約は簡潔に、30文字程度にしてください
- 重要なポイントを10〜15個程度抽出してください
- JSONのみを返してください。説明文は不要です

## 文字起こしテキスト:
${transcription}
`;
      
      // 音声データをPart形式で準備
      const audioPart = {
        inlineData: {
          data: Buffer.from(audioData).toString('base64'),
          mimeType: 'audio/wav',
        },
      };
      
      // Gemini APIを呼び出し
      console.log('Gemini APIにタイムスタンプ抽出リクエストを送信します...');
      const result = await model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      
      console.log('タイムスタンプ抽出完了');
      
      // JSONを抽出
      let jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) {
        // JSONブロックがない場合は、テキスト全体をJSONとして解析を試みる
        jsonMatch = [null, text.trim()];
      }
      
      try {
        const timestampsData = JSON.parse(jsonMatch[1]);
        console.log(`抽出されたタイムスタンプ: ${timestampsData.timestamps.length}個`);
        return timestampsData;
      } catch (parseError) {
        console.error('タイムスタンプJSONの解析に失敗しました:', parseError);
        console.log('生のレスポンス:', text);
        throw new Error('タイムスタンプの解析に失敗しました');
      }
    } catch (error) {
      console.error('タイムスタンプ抽出中にエラーが発生しました:', error);
      // エラー時は空のタイムスタンプ配列を返す
      return { timestamps: [] };
    }
  }

  // 音声ファイルをGemini APIに最適な形式に変換
  async optimizeAudioForGemini(audioPath) {
    const tempDir = path.join(os.tmpdir(), 'gemini-audio-' + crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(tempDir, { recursive: true });
    
    const outputPath = path.join(tempDir, 'optimized.wav');
    
    try {
      // FFmpegを使用して音声を最適化（16kHz、モノラル、WAV形式）
      execSync(`ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}"`, {
        stdio: 'inherit'
      });
      
      console.log(`音声ファイルを最適化しました: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error('音声最適化中にエラーが発生しました:', error);
      // 最適化に失敗した場合は元のファイルを使用
      console.log('最適化に失敗したため、元のファイルを使用します');
      return audioPath;
    }
  }

  // Gemini APIを使用して音声ファイルを文字起こし
  async transcribeWithGemini(audioPath) {
    try {
      console.log(`Gemini APIを使用して文字起こしを開始: ${audioPath}`);
      console.log(`使用するモデル: ${this.geminiModel}`);
      
      // 音声ファイルをバイナリデータとして読み込み
      const audioData = fs.readFileSync(audioPath);
      
      // Geminiモデルの初期化
      const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
      
      // プロンプトの設定
      const prompt = `
以下の音声を文字起こししてください。話者の区別は不要です。
音声が聞き取れない場合は、[聞き取れません]と記載してください。
架空のセミナーや内容を作成しないでください。実際に聞こえる内容のみを書き起こしてください。
日本語の場合は日本語で、英語の場合は英語で文字起こしを行ってください。
`;
      
      // 音声データをPart形式で準備
      const audioPart = {
        inlineData: {
          data: Buffer.from(audioData).toString('base64'),
          mimeType: 'audio/wav',
        },
      };
      
      // Gemini APIを呼び出し
      const result = await model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      
      console.log('文字起こし完了');
      
      // 文字起こし結果の検証
      if (!text || text.trim().length === 0) {
        throw new Error('文字起こし結果が空です');
      }
      
      // 架空の内容が含まれていないか確認
      if (text.includes('セミナー') && text.includes('講師') && text.includes('参加者')) {
        throw new Error('文字起こし結果に架空の内容が含まれている可能性があります');
      }
      
      return text;
    } catch (error) {
      console.error('Gemini APIでの文字起こし中にエラーが発生しました:', error);
      throw error;
    }
  }

  // 大きな音声ファイルを分割して文字起こし（並列処理対応）
  async transcribeLargeAudio(audioPath) {
    try {
      console.log(`大きな音声ファイルを分割して処理します: ${audioPath}`);
      
      // 音声ファイルを3分（180秒）ごとに分割（最適化）
      const chunkDuration = 180; // 秒
      const tempDir = path.join(os.tmpdir(), 'audio-chunks-' + crypto.randomBytes(4).toString('hex'));
      fs.mkdirSync(tempDir, { recursive: true });
      
      // メモリ使用量をログ記録
      const memoryUsage = process.memoryUsage();
      console.log(`メモリ使用量（分割処理開始時）: RSS=${Math.round(memoryUsage.rss / 1024 / 1024)}MB, Heap=${Math.round(memoryUsage.heapUsed / 1024 / 1024)}/${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`);
      
      // FFmpegを使用して音声ファイルの長さを取得
      const durationOutput = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`).toString().trim();
      const totalDuration = parseFloat(durationOutput);
      console.log(`音声ファイルの長さ: ${totalDuration}秒`);
      
      // チャンクの数を計算
      const numChunks = Math.ceil(totalDuration / chunkDuration);
      console.log(`分割するチャンク数: ${numChunks}`);
      
      // チャンク処理用の配列
      const chunkPaths = [];
      
      // チャンクを抽出
      for (let i = 0; i < numChunks; i++) {
        const startTime = i * chunkDuration;
        const chunkPath = path.join(tempDir, `chunk-${i}.wav`);
        
        // FFmpegを使用してチャンクを抽出
        execSync(`ffmpeg -i "${audioPath}" -ss ${startTime} -t ${chunkDuration} -c:a pcm_s16le -ar 16000 -ac 1 "${chunkPath}"`, {
          stdio: 'inherit'
        });
        
        console.log(`チャンク ${i+1}/${numChunks} を抽出しました: ${chunkPath}`);
        chunkPaths.push(chunkPath);
      }
      
      // 並列処理のための関数
      const processChunk = async (chunkPath, index) => {
        try {
          console.log(`チャンク ${index+1}/${numChunks} の文字起こしを開始します...`);
          
          // 各チャンクに対して文脈を考慮したプロンプトを使用
          const chunkTranscription = await this.transcribeWithGemini(chunkPath);
          console.log(`チャンク ${index+1}/${numChunks} の文字起こしが完了しました`);
          
          // 一時ファイルを削除
          fs.unlinkSync(chunkPath);
          
          // メモリ解放を促進
          if (global.gc) {
            global.gc();
          }
          
          return { index, text: chunkTranscription };
        } catch (error) {
          console.error(`チャンク ${index+1}/${numChunks} の文字起こし中にエラーが発生しました:`, error);
          
          // 一時ファイルを削除
          try {
            fs.unlinkSync(chunkPath);
          } catch (unlinkError) {
            console.error(`チャンクファイルの削除に失敗しました: ${chunkPath}`, unlinkError);
          }
          
          return { index, text: `[チャンク ${index+1} の文字起こしに失敗しました]` };
        }
      };
      
      // 並列処理の実行（最大3つまで同時実行）
      const CONCURRENT_LIMIT = 3;
      const transcriptionResults = new Array(numChunks).fill('');
      
      for (let i = 0; i < chunkPaths.length; i += CONCURRENT_LIMIT) {
        const batch = chunkPaths.slice(i, i + CONCURRENT_LIMIT).map((chunkPath, batchIndex) => 
          processChunk(chunkPath, i + batchIndex)
        );
        
        const batchResults = await Promise.all(batch);
        
        // 結果を正しい位置に格納
        for (const result of batchResults) {
          transcriptionResults[result.index] = result.text;
        }
        
        // バッチ間で待機（APIレート制限対策とメモリ解放のため）
        if (i + CONCURRENT_LIMIT < chunkPaths.length) {
          console.log('次のバッチ処理前に3秒間待機します...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // メモリ使用量をログ記録
          const batchMemoryUsage = process.memoryUsage();
          console.log(`メモリ使用量（バッチ処理後）: RSS=${Math.round(batchMemoryUsage.rss / 1024 / 1024)}MB, Heap=${Math.round(batchMemoryUsage.heapUsed / 1024 / 1024)}/${Math.round(batchMemoryUsage.heapTotal / 1024 / 1024)}MB`);
          
          // メモリ解放を促進
          if (global.gc) {
            global.gc();
          }
        }
      }
      
      // 一時ディレクトリを削除
      try {
        fs.rmdirSync(tempDir, { recursive: true });
      } catch (rmdirError) {
        console.error('一時ディレクトリの削除に失敗しました:', rmdirError);
      }
      
      // すべてのチャンクの文字起こし結果を結合
      const fullTranscription = transcriptionResults.join('\n\n');
      console.log('すべてのチャンクの文字起こしが完了しました');
      
      // メモリ使用量をログ記録
      const finalMemoryUsage = process.memoryUsage();
      console.log(`メモリ使用量（処理完了時）: RSS=${Math.round(finalMemoryUsage.rss / 1024 / 1024)}MB, Heap=${Math.round(finalMemoryUsage.heapUsed / 1024 / 1024)}/${Math.round(finalMemoryUsage.heapTotal / 1024 / 1024)}MB`);
      
      return fullTranscription;
    } catch (error) {
      console.error('大きな音声ファイルの分割処理中にエラーが発生しました:', error);
      throw error;
    } finally {
      // 明示的にガベージコレクションを促す
      if (global.gc) {
        global.gc();
      }
    }
  }
}

module.exports = { TranscriptionService };
