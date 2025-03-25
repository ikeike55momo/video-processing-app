import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import { SpeechClient } from '@google-cloud/speech';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import axios from 'axios';
import { pipeline } from 'stream/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// 高精度文字起こしサービスクラス
// Gemini FlashとCloud Speech-to-Textを組み合わせて高精度な文字起こしを実現
export class TranscriptionService {
  private genAI: GoogleGenerativeAI;
  private speechClient: SpeechClient;
  private geminiModel: string;
  private s3Client: S3Client;

  constructor() {
    // Gemini APIの初期化
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY環境変数が設定されていません');
    }
    this.genAI = new GoogleGenerativeAI(geminiApiKey);
    
    // 環境変数からモデル名を取得（デフォルトはgemini-2.0-flash）
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    
    // Google Cloud Speech-to-Text APIの初期化
    this.speechClient = new SpeechClient();
    
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

  // 音声ファイルの文字起こし処理
  async transcribeAudio(fileUrl: string): Promise<string> {
    let localFilePath = '';
    let tempDir = '';
    
    try {
      console.log(`文字起こし処理を開始: ${fileUrl}`);
      
      // 一時ディレクトリの作成
      tempDir = path.join(os.tmpdir(), 'transcription-' + crypto.randomBytes(6).toString('hex'));
      fs.mkdirSync(tempDir, { recursive: true });
      
      // ファイルのダウンロード
      localFilePath = await this.downloadFile(fileUrl, tempDir);
      console.log(`ファイルのダウンロード完了: ${localFilePath}`);
      
      // ファイル形式を確認
      const fileExt = path.extname(localFilePath).toLowerCase();
      let audioFilePath = localFilePath;
      
      // 動画ファイルの場合は音声を抽出
      if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(fileExt)) {
        console.log('動画ファイルから音声を抽出します');
        audioFilePath = path.join(tempDir, `audio-${crypto.randomBytes(4).toString('hex')}.mp3`);
        await this.extractAudioFromVideo(localFilePath, audioFilePath);
        console.log(`音声抽出完了: ${audioFilePath}`);
      }
      
      // Gemini Flashでの文字起こし
      console.log('Gemini Flashでの文字起こしを開始');
      const geminiTranscript = await this.transcribeWithGemini(audioFilePath);
      console.log('Gemini Flashでの文字起こし完了');
      
      // Cloud Speech-to-Textでの文字起こし
      console.log('Cloud Speech-to-Textでの文字起こしを開始');
      const speechToTextTranscript = await this.transcribeWithSpeechToText(audioFilePath);
      console.log('Cloud Speech-to-Textでの文字起こし完了');
      
      // 両方の結果をマージ
      console.log('両方の文字起こし結果をマージします');
      const mergedTranscript = await this.mergeTranscripts(geminiTranscript, speechToTextTranscript);
      
      return mergedTranscript;
    } catch (error) {
      console.error('文字起こし処理中にエラーが発生しました:', error);
      
      // エラー発生時、どちらかの結果が得られていれば返す
      if (error instanceof Error && error.message === 'MERGE_FAILED') {
        try {
          // Gemini Flashでの文字起こし（再試行）
          console.log('Gemini Flashでの文字起こしを再試行');
          const geminiTranscript = await this.transcribeWithGemini(localFilePath);
          return geminiTranscript;
        } catch (retryError) {
          console.error('Gemini Flashでの再試行に失敗:', retryError);
          throw new Error('すべての文字起こし方法が失敗しました');
        }
      }
      
      throw error;
    } finally {
      // 一時ファイルの削除
      try {
        if (localFilePath && fs.existsSync(localFilePath)) {
          fs.unlinkSync(localFilePath);
        }
        if (tempDir && fs.existsSync(tempDir)) {
          fs.rmdirSync(tempDir, { recursive: true });
        }
      } catch (cleanupError) {
        console.error('一時ファイルの削除に失敗しました:', cleanupError);
      }
    }
  }

  // ファイルのダウンロード処理
  private async downloadFile(fileUrl: string, tempDir: string): Promise<string> {
    // R2バケット名
    const r2BucketName = process.env.R2_BUCKET_NAME || 'video-processing';
    
    // ファイルのダウンロード処理
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      if (!fileUrl.includes('r2.cloudflarestorage.com') && !fileUrl.includes('cloudflare')) {
        // 公開URLからダウンロード
        console.log(`公開URLからファイルをダウンロードします: ${fileUrl}`);
        const localFilePath = path.join(tempDir, 'file' + path.extname(fileUrl) || '.mp4');
        
        const response = await axios({
          method: 'get',
          url: fileUrl,
          responseType: 'stream'
        });
        
        await pipeline(
          response.data,
          fs.createWriteStream(localFilePath)
        );
        
        return localFilePath;
      } else {
        // R2の署名付きURLからダウンロード
        console.log(`R2の署名付きURLからファイルをダウンロードします: ${fileUrl}`);
        
        let key = '';
        // URLからキーを抽出
        if (fileUrl.includes('r2.cloudflarestorage.com')) {
          const urlObj = new URL(fileUrl);
          const pathParts = urlObj.pathname.split('/');
          pathParts.shift(); // 先頭の空文字を削除
          if (pathParts[0] === r2BucketName) {
            pathParts.shift(); // バケット名を削除
          }
          key = pathParts.join('/');
        } else {
          key = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
        }
        
        const localFilePath = path.join(tempDir, path.basename(key));
        
        const response = await axios({
          method: 'get',
          url: fileUrl,
          responseType: 'stream'
        });
        
        await pipeline(
          response.data,
          fs.createWriteStream(localFilePath)
        );
        
        return localFilePath;
      }
    } else {
      // ローカルパスまたはR2キーの場合
      console.log(`R2からファイルをダウンロードします: ${fileUrl}`);
      
      const key = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
      const localFilePath = path.join(tempDir, path.basename(key));
      
      // 署名付きURLを生成
      const command = new GetObjectCommand({
        Bucket: r2BucketName,
        Key: key
      });
      
      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
      
      const response = await axios({
        method: 'get',
        url: signedUrl,
        responseType: 'stream'
      });
      
      await pipeline(
        response.data,
        fs.createWriteStream(localFilePath)
      );
      
      return localFilePath;
    }
  }

  // 動画から音声を抽出
  private async extractAudioFromVideo(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`動画から音声を抽出: ${videoPath} -> ${outputPath}`);
      
      const ffmpeg = require('fluent-ffmpeg');
      const ffmpegPath = require('ffmpeg-static');
      ffmpeg.setFfmpegPath(ffmpegPath);
      
      ffmpeg(videoPath)
        .outputOptions([
          '-vn',                // 映像を除去
          '-acodec libmp3lame', // MP3エンコーダを使用
          '-ab 128k',           // ビットレート128k
          '-ar 44100'           // サンプルレート44.1kHz
        ])
        .save(outputPath)
        .on('end', () => {
          console.log('音声抽出が完了しました');
          resolve();
        })
        .on('error', (err: Error) => {
          console.error('音声抽出中にエラーが発生しました:', err);
          reject(err);
        });
    });
  }

  // 音声ファイルをCloud Speech-to-Text用にFLACに変換
  private async convertAudioToFlac(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`音声ファイルをFLACに変換: ${inputPath} -> ${outputPath}`);
      
      const ffmpeg = require('fluent-ffmpeg');
      const ffmpegPath = require('ffmpeg-static');
      ffmpeg.setFfmpegPath(ffmpegPath);
      
      ffmpeg(inputPath)
        .outputOptions([
          '-vn',                // 映像を除去（既に音声ファイルの場合も安全）
          '-acodec flac',       // FLACエンコーダを使用
          '-ar 16000',          // サンプルレート16kHz（Speech-to-Textの推奨値）
          '-ac 1'               // モノラルチャンネル
        ])
        .save(outputPath)
        .on('end', () => {
          console.log('FLACへの変換が完了しました');
          resolve();
        })
        .on('error', (err: Error) => {
          console.error('FLACへの変換中にエラーが発生しました:', err);
          reject(err);
        });
    });
  }

  // Gemini APIを使用した文字起こし
  private async transcribeWithGemini(audioPath: string): Promise<string> {
    try {
      console.log(`Gemini APIを使用して文字起こしを開始: ${audioPath}`);
      
      // 音声ファイルを読み込み
      const audioData = fs.readFileSync(audioPath);
      
      // Geminiモデルの取得
      const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
      
      // プロンプトの作成
      const prompt = `
      以下の音声ファイルを文字起こししてください。
      日本語の場合は、自然な日本語で書き起こしてください。
      英語の場合は、そのまま英語で書き起こしてください。
      話者が複数いる場合は、可能であれば話者を区別してください。
      音声が不明瞭な場合は、推測せずに[不明瞭]と記載してください。
      `;
      
      // 音声データをBase64エンコード
      const base64Audio = audioData.toString('base64');
      const mimeType = 'audio/mp3';
      
      // Gemini APIへのリクエスト
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Audio
                }
              }
            ]
          }
        ]
      });
      
      const response = result.response;
      const transcription = response.text();
      
      console.log('Gemini APIでの文字起こしが完了しました');
      return transcription;
    } catch (error) {
      console.error('Gemini APIでの文字起こし中にエラーが発生しました:', error);
      throw error;
    }
  }

  // Google Cloud Speech-to-Textを使用した文字起こし
  private async transcribeWithSpeechToText(audioPath: string): Promise<string> {
    try {
      console.log(`Cloud Speech-to-Textを使用して文字起こしを開始: ${audioPath}`);
      
      // 音声ファイルをFLAC形式に変換
      const flacPath = audioPath.replace(/\.[^/.]+$/, '') + '.flac';
      await this.convertAudioToFlac(audioPath, flacPath);
      console.log(`FLACに変換完了: ${flacPath}`);
      
      // FLAC音声ファイルを読み込み
      const audioBytes = fs.readFileSync(flacPath).toString('base64');
      
      // Speech-to-Text APIへのリクエスト設定
      const request = {
        audio: {
          content: audioBytes,
        },
        config: {
          encoding: 'FLAC' as const,
          sampleRateHertz: 16000,
          languageCode: 'ja-JP', // 日本語を優先
          alternativeLanguageCodes: ['en-US'], // 英語もサポート
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: false,
          model: 'default', // 'default', 'phone_call', 'video', 'latest_short'など
          useEnhanced: true, // 拡張モデルを使用
        },
      };
      
      // Speech-to-Text APIへのリクエスト
      const [response] = await this.speechClient.recognize(request);
      
      // 結果の処理
      const transcription = response.results
        ?.map(result => result.alternatives?.[0]?.transcript || '')
        .join('\n') || '';
      
      console.log('Cloud Speech-to-Textでの文字起こしが完了しました');
      
      // 一時FLAC音声ファイルを削除
      try {
        if (fs.existsSync(flacPath)) {
          fs.unlinkSync(flacPath);
          console.log(`一時FLACファイルを削除しました: ${flacPath}`);
        }
      } catch (cleanupError) {
        console.error('一時FLACファイルの削除に失敗しました:', cleanupError);
      }
      
      return transcription;
    } catch (error) {
      console.error('Cloud Speech-to-Textでの文字起こし中にエラーが発生しました:', error);
      throw error;
    }
  }

  // 両方の文字起こし結果をマージ
  private async mergeTranscripts(geminiTranscript: string, speechToTextTranscript: string): Promise<string> {
    try {
      console.log('両方の文字起こし結果をマージします');
      
      // どちらかの結果が空の場合は、もう一方を返す
      if (!geminiTranscript || geminiTranscript.trim() === '') {
        return speechToTextTranscript;
      }
      if (!speechToTextTranscript || speechToTextTranscript.trim() === '') {
        return geminiTranscript;
      }
      
      // Geminiモデルの取得
      const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
      
      // プロンプトの作成
      const prompt = `
      以下に2つの文字起こし結果があります。これらを比較して、最も正確で読みやすい文字起こしを生成してください。
      
      文字起こし1（Gemini Flash）:
      ${geminiTranscript}
      
      文字起こし2（Cloud Speech-to-Text）:
      ${speechToTextTranscript}
      
      以下の点に注意して最終的な文字起こしを生成してください：
      1. 両方の文字起こしの長所を組み合わせる
      2. 文脈に合わない単語や表現を修正する
      3. 話者が複数いる場合は、可能であれば話者を区別する
      4. 自然な文章になるように調整する
      5. 音声が不明瞭な部分は[不明瞭]と記載する
      
      最終的な文字起こしのみを出力してください。説明や分析は不要です。
      `;
      
      // Gemini APIへのリクエスト
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ]
      });
      
      const response = result.response;
      const mergedTranscript = response.text();
      
      console.log('文字起こし結果のマージが完了しました');
      return mergedTranscript;
    } catch (error) {
      console.error('文字起こし結果のマージ中にエラーが発生しました:', error);
      // マージに失敗した場合は特定のエラーを投げる
      throw new Error('MERGE_FAILED');
    }
  }
}
