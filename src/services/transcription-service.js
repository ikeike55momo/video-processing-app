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

  // 大きな音声ファイルを分割して文字起こし
  async transcribeLargeAudio(audioPath) {
    try {
      console.log(`大きな音声ファイルを分割して処理します: ${audioPath}`);
      
      // 音声ファイルを5分（300秒）ごとに分割
      const chunkDuration = 300; // 秒
      const tempDir = path.join(os.tmpdir(), 'audio-chunks-' + crypto.randomBytes(4).toString('hex'));
      fs.mkdirSync(tempDir, { recursive: true });
      
      // FFmpegを使用して音声ファイルの長さを取得
      const durationOutput = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`).toString().trim();
      const totalDuration = parseFloat(durationOutput);
      console.log(`音声ファイルの長さ: ${totalDuration}秒`);
      
      // チャンクの数を計算
      const numChunks = Math.ceil(totalDuration / chunkDuration);
      console.log(`分割するチャンク数: ${numChunks}`);
      
      const transcriptions = [];
      
      // 各チャンクを処理
      for (let i = 0; i < numChunks; i++) {
        const startTime = i * chunkDuration;
        const chunkPath = path.join(tempDir, `chunk-${i}.wav`);
        
        // FFmpegを使用してチャンクを抽出
        execSync(`ffmpeg -i "${audioPath}" -ss ${startTime} -t ${chunkDuration} -c:a pcm_s16le -ar 16000 -ac 1 "${chunkPath}"`, {
          stdio: 'inherit'
        });
        
        console.log(`チャンク ${i+1}/${numChunks} を抽出しました: ${chunkPath}`);
        
        // チャンクを文字起こし
        console.log(`チャンク ${i+1}/${numChunks} の文字起こしを開始します...`);
        let chunkTranscription;
        
        try {
          // 各チャンクに対して文脈を考慮したプロンプトを使用
          chunkTranscription = await this.transcribeWithGemini(chunkPath);
          console.log(`チャンク ${i+1}/${numChunks} の文字起こしが完了しました`);
        } catch (error) {
          console.error(`チャンク ${i+1}/${numChunks} の文字起こし中にエラーが発生しました:`, error);
          chunkTranscription = `[チャンク ${i+1} の文字起こしに失敗しました]`;
        }
        
        transcriptions.push(chunkTranscription);
        
        // 一時ファイルを削除
        fs.unlinkSync(chunkPath);
      }
      
      // 一時ディレクトリを削除
      fs.rmdirSync(tempDir, { recursive: true });
      
      // すべてのチャンクの文字起こし結果を結合
      const fullTranscription = transcriptions.join('\n\n');
      console.log('すべてのチャンクの文字起こしが完了しました');
      
      return fullTranscription;
    } catch (error) {
      console.error('大きな音声ファイルの分割処理中にエラーが発生しました:', error);
      throw error;
    }
  }
}

module.exports = { TranscriptionService };
