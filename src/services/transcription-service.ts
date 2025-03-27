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

  // 音声ファイルを文字起こし（フォールバックメカニズム付き）
  async transcribeAudio(audioPath: string): Promise<string> {
    console.log(`文字起こし処理を開始: ${audioPath}`);
    
    try {
      // 第1段階: 高精度処理を試行（Gemini + Speech-to-Text）
      try {
        const transcription = await this.processLocalFile(audioPath);
        // 成功した場合は一時ファイルをクリーンアップして結果を返す
        this.cleanupAllTempFiles();
        return transcription;
      } catch (localError: unknown) {
        console.error('ローカルファイル処理エラー:', localError);
        throw new Error(`ローカルファイル処理に失敗しました: ${localError instanceof Error ? localError.message : String(localError)}`);
      }
    } catch (error: unknown) {
      console.error(`文字起こし処理エラー:`, error);
      
      // 第2段階: Geminiのみで文字起こしを試行
      console.log(`フォールバック: 従来のGemini文字起こしを試します...`);
      
      try {
        const fallbackTranscription = await this.transcribeWithGemini(audioPath);
        
        if (fallbackTranscription && fallbackTranscription.trim().length > 0) {
          console.log(`フォールバック成功: Geminiでの文字起こしが完了しました`);
          // 成功した場合は一時ファイルをクリーンアップして結果を返す
          this.cleanupAllTempFiles();
          return fallbackTranscription;
        } else {
          throw new Error('フォールバック文字起こし結果が空です');
        }
      } catch (fallbackError: unknown) {
        console.error(`フォールバック文字起こしエラー:`, fallbackError);
        
        // 第3段階: Speech-to-Textのみで文字起こしを試行
        console.log(`最終フォールバック: Speech-to-Textのみで文字起こしを試します...`);
        
        try {
          // 一時ディレクトリの作成
          const tempDir = path.join(os.tmpdir(), 'speech-fallback-' + crypto.randomBytes(6).toString('hex'));
          fs.mkdirSync(tempDir, { recursive: true });
          
          // ファイルのダウンロード
          const localFilePath = await this.downloadFile(audioPath, tempDir);
          console.log(`Speech-to-Text用にファイルをダウンロードしました: ${localFilePath}`);
          
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
          
          // Speech-to-Textで文字起こし
          const speechTranscription = await this.transcribeWithSpeechToText(audioFilePath);
          
          if (speechTranscription && speechTranscription.trim().length > 0) {
            console.log(`最終フォールバック成功: Speech-to-Textでの文字起こしが完了しました`);
            // 成功した場合は一時ファイルをクリーンアップして結果を返す
            this.cleanupAllTempFiles();
            return speechTranscription;
          } else {
            throw new Error('Speech-to-Text文字起こし結果が空です');
          }
        } catch (speechError: unknown) {
          console.error(`Speech-to-Text文字起こしエラー:`, speechError);
          // すべての一時ファイルをクリーンアップ
          this.cleanupAllTempFiles();
          throw new Error(`すべての文字起こし方法が失敗しました: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  // 一時ファイル削除関数
  private cleanupTempFiles(filePaths: string[]): void {
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`一時ファイルを削除しました: ${filePath}`);
        }
      } catch (cleanupError: unknown) {
        console.error(`一時ファイル ${filePath} の削除に失敗しました:`, cleanupError);
      }
    }
  }

  // すべての一時ファイルを削除する関数
  private cleanupAllTempFiles(): void {
    try {
      // 一時ディレクトリのパターン
      const tempDirPattern = /video-processing-[a-z0-9]+/;
      
      // /tmpディレクトリ内のファイルを検索
      const tempDir = os.tmpdir();
      const files = fs.readdirSync(tempDir);
      
      // video-processing関連の一時ディレクトリを検索して削除
      for (const file of files) {
        if (tempDirPattern.test(file)) {
          const fullPath = path.join(tempDir, file);
          try {
            // ディレクトリの場合は再帰的に削除
            if (fs.statSync(fullPath).isDirectory()) {
              this.removeDirectoryRecursive(fullPath);
              console.log(`一時ディレクトリを削除しました: ${fullPath}`);
            } else {
              fs.unlinkSync(fullPath);
              console.log(`一時ファイルを削除しました: ${fullPath}`);
            }
          } catch (err) {
            console.error(`一時ファイル/ディレクトリの削除に失敗しました: ${fullPath}`, err);
          }
        }
      }
    } catch (error) {
      console.error('一時ファイルのクリーンアップ中にエラーが発生しました:', error);
    }
  }

  // ディレクトリを再帰的に削除する関数
  private removeDirectoryRecursive(dirPath: string): void {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach((file) => {
        const curPath = path.join(dirPath, file);
        if (fs.statSync(curPath).isDirectory()) {
          // 再帰的にサブディレクトリを削除
          this.removeDirectoryRecursive(curPath);
        } else {
          // ファイルを削除
          fs.unlinkSync(curPath);
        }
      });
      // 空になったディレクトリを削除
      fs.rmdirSync(dirPath);
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
        .on('error', (err: unknown) => {
          console.error('音声抽出中にエラーが発生しました:', err);
          reject(err);
        });
    });
  }

  // 音声ファイルをWAVに変換する関数
  private async convertAudioToWav(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`音声ファイルをWAVに変換: ${inputPath} -> ${outputPath}`);
      
      const ffmpeg = require('fluent-ffmpeg');
      const ffmpegPath = require('ffmpeg-static');
      ffmpeg.setFfmpegPath(ffmpegPath);
      
      ffmpeg(inputPath)
        .outputOptions([
          '-vn',                // 映像を除去
          '-acodec pcm_s16le',  // PCM 16bit LEエンコード（LINEAR16形式）
          '-ar 16000',          // サンプルレート16kHz
          '-ac 1',              // モノラルチャンネル
          '-f wav'              // WAV形式を明示的に指定
        ])
        .output(outputPath)
        .on('start', (commandLine: string) => {
          console.log('FFmpeg WAV変換コマンド:', commandLine);
        })
        .on('end', () => {
          // ファイルの存在と最小サイズを確認
          if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100) {
            console.log('WAVへの変換が完了しました');
            resolve();
          } else {
            const error = new Error('変換されたWAVファイルが無効です');
            console.error(error);
            reject(error);
          }
        })
        .on('error', (err: unknown) => {
          console.error('WAVへの変換中にエラーが発生しました:', err);
          reject(err);
        })
        .run();
    });
  }

  // 音声ファイルをFLACに変換する関数
  private async convertAudioToFlac(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`音声ファイルをFLACに変換: ${inputPath} -> ${outputPath}`);
      
      const ffmpeg = require('fluent-ffmpeg');
      const ffmpegPath = require('ffmpeg-static');
      ffmpeg.setFfmpegPath(ffmpegPath);
      
      ffmpeg(inputPath)
        .outputOptions([
          '-vn',                // 映像を除去
          '-acodec flac',       // FLACエンコーダーを使用
          '-ar 16000',          // サンプルレート16kHz（Speech-to-Textの推奨値）
          '-ac 1',              // モノラルチャンネル
          '-bits_per_raw_sample 16', // 16ビット深度
          '-compression_level 8',    // 高圧縮率（0-12、8は標準的な値）
          '-f flac'             // FLAC形式を明示的に指定
        ])
        .output(outputPath)
        .on('start', (commandLine: string) => {
          console.log('FFmpeg FLAC変換コマンド:', commandLine);
        })
        .on('end', () => {
          // ファイルの存在と最小サイズを確認
          if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100) {
            console.log('FLACへの変換が完了しました');
            resolve();
          } else {
            const error = new Error('変換されたFLACファイルが無効です');
            console.error(error);
            reject(error);
          }
        })
        .on('error', (err: Error) => {
          console.error('FLAC変換エラー:', err);
          reject(err);
        })
        .run();
    });
  }

  // Google Cloud Speech-to-Textを使用した文字起こし
  private async transcribeWithSpeechToText(audioPath: string): Promise<string> {
    let wavPath = '';
    try {
      console.log(`Cloud Speech-to-Textを使用して文字起こしを開始: ${audioPath}`);
      
      // 音声ファイルをWAV形式に変換
      wavPath = audioPath.replace(/\.[^/.]+$/, '') + '.wav';
      
      try {
        // 元の音声ファイルから直接WAVに変換
        await this.convertAudioToWav(audioPath, wavPath);
        console.log(`WAVに変換完了: ${wavPath}`);
      } catch (convErr: unknown) {
        console.error('音声フォーマット変換エラー:', convErr);
        throw new Error(`音声ファイルの変換に失敗しました: ${convErr instanceof Error ? convErr.message : String(convErr)}`);
      }
      
      // WAVファイルの内容を読み込み
      const audioBytes = fs.readFileSync(wavPath).toString('base64');
      
      // 処理が終わったらすぐに一時ファイルを削除
      this.cleanupTempFiles([wavPath]);
      
      // Speech-to-Text APIリクエストの設定
      const request = {
        audio: {
          content: audioBytes,
        },
        config: {
          encoding: 'LINEAR16' as const, // WAVファイルのエンコーディング
          sampleRateHertz: 16000,
          languageCode: 'ja-JP',
          model: 'default',
          enableAutomaticPunctuation: true,
          useEnhanced: true,
          audioChannelCount: 1,
        },
      };
      
      // Speech-to-Text APIを呼び出し
      const [response] = await this.speechClient.recognize(request);
      
      if (!response || !response.results || response.results.length === 0) {
        console.warn('Speech-to-Text: 文字起こし結果が空です');
        return '';
      }
      
      // 結果を結合
      const transcription = response.results
        .map((result: any) => result.alternatives && result.alternatives[0] ? result.alternatives[0].transcript : '')
        .join('\n')
        .trim();
      
      console.log('Cloud Speech-to-Textでの文字起こしが完了しました');
      
      return transcription;
    } catch (error: unknown) {
      console.error('Speech-to-Text文字起こしエラー:', error);
      // エラーが発生した場合も一時ファイルを削除
      if (wavPath) {
        this.cleanupTempFiles([wavPath]);
      }
      throw new Error(`Speech-to-Text文字起こしエラー: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    } catch (error: unknown) {
      console.error('Gemini APIでの文字起こし中にエラーが発生しました:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  // 両方の文字起こし結果をマージ
  private async mergeTranscripts(geminiTranscript: string, speechToTextTranscript: string): Promise<string> {
    try {
      console.log('両方の文字起こし結果をマージします');
      
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
    } catch (error: unknown) {
      console.error('文字起こし結果のマージ中にエラーが発生しました:', error);
      // マージに失敗した場合は特定のエラーを投げる
      throw new Error('MERGE_FAILED');
    }
  }

  // ローカルファイルを処理する関数
  private async processLocalFile(audioPath: string): Promise<string> {
    let localFilePath = '';
    let tempDir = '';
    let tempFiles: string[] = [];
    
    try {
      console.log(`文字起こし処理を開始: ${audioPath}`);
      
      // 一時ディレクトリの作成
      tempDir = path.join(os.tmpdir(), 'transcription-' + crypto.randomBytes(6).toString('hex'));
      fs.mkdirSync(tempDir, { recursive: true });
      
      // ファイルのダウンロード
      localFilePath = await this.downloadFile(audioPath, tempDir);
      tempFiles.push(localFilePath);
      console.log(`ファイルのダウンロード完了: ${localFilePath}`);
      
      // ファイル形式を確認
      const fileExt = path.extname(localFilePath).toLowerCase();
      let audioFilePath = localFilePath;
      
      // 動画ファイルの場合は音声を抽出
      if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(fileExt)) {
        console.log('動画ファイルから音声を抽出します');
        audioFilePath = path.join(tempDir, `audio-${crypto.randomBytes(4).toString('hex')}.mp3`);
        tempFiles.push(audioFilePath);
        await this.extractAudioFromVideo(localFilePath, audioFilePath);
        console.log(`音声抽出完了: ${audioFilePath}`);
      }
      
      // 両方の文字起こしを並列で実行
      console.log('Gemini FlashとCloud Speech-to-Textでの文字起こしを並列で開始');
      const [geminiPromise, speechToTextPromise] = await Promise.allSettled([
        this.transcribeWithGemini(audioFilePath),
        this.transcribeWithSpeechToText(audioFilePath)
      ]);
      
      // 結果の取得
      const geminiTranscript = geminiPromise.status === 'fulfilled' ? geminiPromise.value : '';
      const speechToTextTranscript = speechToTextPromise.status === 'fulfilled' ? speechToTextPromise.value : '';
      
      // 結果のログ出力
      console.log(`Gemini Flash結果: ${geminiPromise.status === 'fulfilled' ? '成功' : '失敗'}`);
      console.log(`Cloud Speech-to-Text結果: ${speechToTextPromise.status === 'fulfilled' ? '成功' : '失敗'}`);
      
      // エラーログ
      if (geminiPromise.status === 'rejected') {
        console.error('Gemini Flashでの文字起こしに失敗:', geminiPromise.reason);
      }
      if (speechToTextPromise.status === 'rejected') {
        console.error('Cloud Speech-to-Textでの文字起こしに失敗:', speechToTextPromise.reason);
      }
      
      // どちらか一方でも成功していれば処理を続行
      if (geminiTranscript || speechToTextTranscript) {
        // 両方成功した場合はマージ
        if (geminiTranscript && speechToTextTranscript) {
          try {
            console.log('両方の文字起こし結果をマージします');
            return await this.mergeTranscripts(geminiTranscript, speechToTextTranscript);
          } catch (mergeError: unknown) {
            console.error('マージ処理中にエラーが発生しました:', mergeError);
            // マージに失敗した場合はGemini結果を優先
            return geminiTranscript || speechToTextTranscript;
          }
        }
        // どちらか一方のみ成功した場合はその結果を返す
        return geminiTranscript || speechToTextTranscript;
      }
      
      // 両方失敗した場合はエラー
      throw new Error('すべての文字起こし方法が失敗しました');
    } catch (error: unknown) {
      console.error('文字起こし処理中にエラーが発生しました:', error);
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      // 一時ファイルの削除
      this.cleanupTempFiles(tempFiles);
      
      // 一時ディレクトリの削除
      try {
        if (tempDir && fs.existsSync(tempDir)) {
          fs.rmdirSync(tempDir, { recursive: true });
        }
      } catch (cleanupError: unknown) {
        console.error('一時ディレクトリの削除に失敗しました:', cleanupError);
      }
    }
  }
}
