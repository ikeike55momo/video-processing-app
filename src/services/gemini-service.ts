import { GoogleGenerativeAI } from '@google/generative-ai';
import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as util from 'util';
import * as stream from 'stream';
import * as crypto from 'crypto';

// ffmpegのインポート
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

// Gemini AIサービスクラス
export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: string;
  private storage: Storage;
  private pipeline = util.promisify(stream.pipeline);

  constructor() {
    // APIキーの取得
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY環境変数が設定されていません');
    }

    // Gemini APIの初期化
    this.genAI = new GoogleGenerativeAI(apiKey);
    
    // 環境変数からモデル名を取得（デフォルトはgemini-2.5-pro-exp-03-25）
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-pro-exp-03-25';
    this.model = modelName;
    
    // Google Cloud Storageの初期化
    const credentials = JSON.parse(
      Buffer.from(process.env.GCP_CREDENTIALS_BASE64 || '', 'base64').toString()
    );
    this.storage = new Storage({ credentials });
    
    console.log(`Geminiモデルを初期化: ${this.model}`);
  }

  // 文字起こし処理
  async transcribeAudio(audioUrl: string): Promise<string> {
    try {
      console.log(`音声/動画ファイルの文字起こしを開始: ${audioUrl}`);
      
      // Google Cloud Storageから動画/音声ファイルを取得
      const gcsMatch = audioUrl.match(/gs:\/\/([^\/]+)\/(.+)/);
      
      if (!gcsMatch) {
        throw new Error(`無効なGoogle Cloud Storage URL: ${audioUrl}`);
      }
      
      const bucketName = gcsMatch[1];
      const filePath = gcsMatch[2];
      
      // 一時ファイルのパスを生成
      const tempDir = os.tmpdir();
      const randomId = crypto.randomBytes(8).toString('hex');
      const tempFilePath = path.join(tempDir, `${randomId}-${path.basename(filePath)}`);
      
      console.log(`一時ファイルをダウンロード: ${tempFilePath}`);
      
      // ファイルをダウンロード
      await this.downloadFile(bucketName, filePath, tempFilePath);
      
      // ファイル形式を確認
      const fileExt = path.extname(tempFilePath).toLowerCase();
      let audioFilePath = tempFilePath;
      
      // 動画ファイルの場合は音声を抽出
      if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(fileExt)) {
        const audioPath = `${tempFilePath}.mp3`;
        await this.extractAudioFromVideo(tempFilePath, audioPath);
        audioFilePath = audioPath;
      }
      
      // Gemini APIを使用して文字起こし
      const transcription = await this.transcribeWithGemini(audioFilePath);
      
      // 一時ファイルの削除
      try {
        fs.unlinkSync(tempFilePath);
        if (audioFilePath !== tempFilePath) {
          fs.unlinkSync(audioFilePath);
        }
      } catch (err) {
        console.warn('一時ファイルの削除に失敗:', err);
      }
      
      return transcription;
    } catch (error) {
      console.error('文字起こし処理中にエラーが発生しました:', error);
      throw error;
    }
  }

  // 動画から音声を抽出
  private async extractAudioFromVideo(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`動画から音声を抽出: ${videoPath} -> ${outputPath}`);
      
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

  // Google Cloud Storageからファイルをダウンロード
  private async downloadFile(bucketName: string, filePath: string, destinationPath: string): Promise<void> {
    const bucket = this.storage.bucket(bucketName);
    const file = bucket.file(filePath);
    
    const writeStream = fs.createWriteStream(destinationPath);
    
    await this.pipeline(
      file.createReadStream(),
      writeStream
    );
    
    console.log(`ファイルのダウンロードが完了: ${bucketName}/${filePath}`);
  }

  // Gemini APIを使用した文字起こし
  private async transcribeWithGemini(audioPath: string): Promise<string> {
    try {
      console.log(`Gemini APIを使用して文字起こしを開始: ${audioPath}`);
      
      // 音声ファイルを読み込み
      const audioData = fs.readFileSync(audioPath);
      
      // Geminiモデルの取得
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
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
                inline_data: {
                  mime_type: mimeType,
                  data: base64Audio
                }
              }
            ]
          }
        ]
      });
      
      const response = result.response;
      const transcription = response.text();
      
      console.log('文字起こしが完了しました');
      return transcription;
    } catch (error) {
      console.error('Gemini APIでの文字起こし中にエラーが発生しました:', error);
      throw error;
    }
  }

  // 文字起こしから要約を生成
  async generateSummary(transcription: string): Promise<string> {
    try {
      console.log('文字起こしから要約を生成します');
      
      // Geminiモデルの取得
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
      // プロンプトの作成
      const prompt = `
      以下の文字起こしテキストを要約してください。
      重要なポイントを箇条書きでまとめ、全体の内容を簡潔に表現してください。
      要約は日本語で作成し、元の内容の本質を保持するようにしてください。
      
      文字起こしテキスト:
      ${transcription}
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
      const summary = response.text();
      
      console.log('要約が完了しました');
      return summary;
    } catch (error) {
      console.error('要約生成中にエラーが発生しました:', error);
      throw error;
    }
  }
}
