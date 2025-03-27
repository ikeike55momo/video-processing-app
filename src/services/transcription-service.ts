import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import axios from 'axios';
import { pipeline } from 'stream/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// 高精度文字起こしサービスクラス
// Gemini FlashとCloud Speech-to-Textを組み合わせて高精度な文字起こしを実現
export class TranscriptionService {
  private genAI: GoogleGenerativeAI;
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
    console.log(`ファイル情報: 存在=${fs.existsSync(audioPath)}, サイズ=${fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 'N/A'} バイト`);
    
    try {
      // 音声ファイルを最適化（すべての処理フローで共通）
      console.log(`音声ファイルの最適化を開始します...`);
      const optimizedAudioPath = await this.optimizeAudioForGemini(audioPath);
      console.log(`音声ファイルを最適化しました: ${optimizedAudioPath}`);
      
      // 音声ファイルのサイズを確認
      const stats = fs.statSync(optimizedAudioPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      console.log(`最適化された音声ファイルのサイズ: ${fileSizeMB.toFixed(2)} MB`);
      
      // Geminiのみで文字起こしを試行
      console.log(`Geminiのみでの処理を開始: ${optimizedAudioPath}`);
      
      try {
        console.log(`[DEBUG] Geminiのみでの処理を開始: ${optimizedAudioPath}`);
        
        let transcription = '';
        
        // 大きなファイルの場合は分割処理
        if (fileSizeMB > 4) {
          console.log(`ファイルサイズが大きいため、分割処理を実行します`);
          transcription = await this.transcribeWithGeminiChunked(optimizedAudioPath);
        } else {
          console.log(`ファイルサイズが小さいため、直接処理します`);
          // 音声ファイルを読み込み
          const audioData = fs.readFileSync(optimizedAudioPath);
          
          // Geminiモデルの取得
          const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
          
          // プロンプトの作成
          const prompt = `
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
          
          // 音声データをBase64エンコード
          const base64Audio = audioData.toString('base64');
          
          // MIMEタイプを設定（最適化後はWAV形式）
          const mimeType = 'audio/wav';
          
          console.log(`使用するMIMEタイプ: ${mimeType}`);
          
          // Gemini APIへのリクエスト
          const result = await model.generateContent([
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Audio
              }
            }
          ]);
          
          const response = result.response;
          transcription = response.text();
        }
        
        // 架空のセミナー内容が含まれていないか確認
        if (transcription.includes('AIスクール') || 
            transcription.includes('LLMの基礎') || 
            transcription.includes('セミナー要約') ||
            transcription.includes('AIを活用して人生を変えた')) {
          console.warn('警告: 架空のセミナー内容が検出されました。文字起こし結果を破棄します。');
          throw new Error('Gemini APIが架空の内容を生成しました。実際の音声データを文字起こしできませんでした。');
        }
        
        if (transcription && transcription.trim().length > 0) {
          console.log(`Geminiのみでの処理が成功しました`);
          console.log(`[DEBUG] Geminiのみでの処理が成功しました。結果の長さ: ${transcription.length} 文字`);
          
          // 一時ファイルを削除
          try {
            if (optimizedAudioPath !== audioPath && fs.existsSync(optimizedAudioPath)) {
              fs.unlinkSync(optimizedAudioPath);
              console.log(`最適化された一時ファイルを削除しました: ${optimizedAudioPath}`);
            }
          } catch (cleanupError) {
            console.warn('一時ファイルの削除に失敗しました:', cleanupError);
          }
          
          // 成功した場合は一時ファイルをクリーンアップして結果を返す
          this.cleanupAllTempFiles();
          return transcription;
        } else {
          throw new Error('Geminiのみでの文字起こし結果が空です');
        }
      } catch (fallbackError: unknown) {
        console.error(`Geminiのみでの文字起こしエラー:`, fallbackError);
        // すべての一時ファイルをクリーンアップ
        this.cleanupAllTempFiles();
        throw new Error(`文字起こし処理に失敗しました: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
      }
    } catch (error: unknown) {
      console.error(`文字起こし処理エラー:`, error);
      throw new Error(`文字起こし処理に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
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

  // Gemini APIを使用した文字起こし
  private async transcribeWithGemini(audioPath: string): Promise<string> {
    try {
      console.log(`Gemini APIを使用して文字起こしを開始: ${audioPath}`);
      
      // 音声ファイルを最適化
      const optimizedAudioPath = await this.optimizeAudioForGemini(audioPath);
      console.log(`音声ファイルを最適化しました: ${optimizedAudioPath}`);
      
      // 音声ファイルのサイズを確認
      const stats = fs.statSync(optimizedAudioPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      console.log(`最適化された音声ファイルのサイズ: ${fileSizeMB.toFixed(2)} MB`);
      
      // 大きなファイルの場合は分割処理
      if (fileSizeMB > 4) {
        console.log(`ファイルサイズが大きいため、分割処理を実行します`);
        return this.transcribeWithGeminiChunked(optimizedAudioPath);
      }
      
      // 音声ファイルを読み込み
      const audioData = fs.readFileSync(optimizedAudioPath);
      
      // Geminiモデルの取得
      const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
      
      // プロンプトの作成
      const prompt = `
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
      
      // 音声データをBase64エンコード
      const base64Audio = audioData.toString('base64');
      
      // ファイル拡張子に基づいてMIMEタイプを決定
      const fileExt = path.extname(optimizedAudioPath).toLowerCase();
      let mimeType = 'audio/wav'; // 最適化後はWAV形式
      
      console.log(`使用するMIMEタイプ: ${mimeType}`);
      
      // Gemini APIへのリクエスト
      const result = await model.generateContent([
        { text: prompt },
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
      
      // 一時ファイルを削除
      try {
        if (optimizedAudioPath !== audioPath && fs.existsSync(optimizedAudioPath)) {
          fs.unlinkSync(optimizedAudioPath);
          console.log(`最適化された一時ファイルを削除しました: ${optimizedAudioPath}`);
        }
      } catch (cleanupError) {
        console.warn('一時ファイルの削除に失敗しました:', cleanupError);
      }
      
      console.log('文字起こしが完了しました');
      return transcription;
    } catch (error) {
      console.error('Gemini APIでの文字起こし中にエラーが発生しました:', error);
      throw error;
    }
  }

  // 音声ファイルをGemini APIに最適な形式に変換
  private async optimizeAudioForGemini(inputPath: string): Promise<string> {
    const outputPath = inputPath.replace(/\.[^/.]+$/, '') + '_optimized.wav';
    
    return new Promise((resolve, reject) => {
      console.log(`音声ファイルを最適化: ${inputPath} -> ${outputPath}`);
      
      try {
        const ffmpeg = require('fluent-ffmpeg');
        const ffmpegPath = require('ffmpeg-static');
        ffmpeg.setFfmpegPath(ffmpegPath);
        
        ffmpeg(inputPath)
          .outputOptions([
            '-vn',                // 映像を除去
            '-acodec pcm_s16le',  // PCM 16bit LEエンコード（LINEAR16形式）
            '-ar 16000',          // サンプルレート16kHz（Gemini推奨）
            '-ac 1',              // モノラルチャンネル
            '-f wav'              // WAV形式を明示的に指定
          ])
          .output(outputPath)
          .on('start', (commandLine: string) => {
            console.log('FFmpeg最適化コマンド:', commandLine);
          })
          .on('end', () => {
            // ファイルの存在と最小サイズを確認
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100) {
              console.log('音声ファイルの最適化が完了しました');
              resolve(outputPath);
            } else {
              const error = new Error('最適化された音声ファイルが無効です');
              console.error(error);
              reject(error);
            }
          })
          .on('error', (err: unknown) => {
            console.error('音声ファイルの最適化中にエラーが発生しました:', err);
            reject(err);
          })
          .run();
      } catch (error) {
        console.error('FFmpegの初期化に失敗しました:', error);
        // FFmpegが使用できない場合は元のファイルを返す
        resolve(inputPath);
      }
    });
  }

  // 大きな音声ファイルを分割して処理
  private async transcribeWithGeminiChunked(audioPath: string): Promise<string> {
    try {
      console.log(`音声ファイルを分割して処理します: ${audioPath}`);
      
      // 音声ファイルのメタデータを取得
      const metadata = await this.getAudioMetadata(audioPath);
      console.log(`音声ファイルのメタデータ:`, metadata);
      
      // 音声の長さ（秒）
      const duration = metadata.format.duration || 0;
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
        const chunkPath = await this.extractAudioChunk(audioPath, start, end);
        console.log(`チャンク抽出完了: ${chunkPath}`);
        
        try {
          // チャンクを処理
          const chunkTranscription = await this.transcribeChunk(chunkPath, i+1, chunks);
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

  // 音声ファイルのメタデータを取得
  private async getAudioMetadata(audioPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        const ffmpeg = require('fluent-ffmpeg');
        ffmpeg.ffprobe(audioPath, (err: Error, metadata: any) => {
          if (err) {
            console.error('メタデータ取得エラー:', err);
            reject(err);
            return;
          }
          resolve(metadata);
        });
      } catch (error) {
        console.error('FFprobeの実行に失敗しました:', error);
        reject(error);
      }
    });
  }

  // 音声ファイルからチャンクを抽出
  private async extractAudioChunk(audioPath: string, start: number, end: number): Promise<string> {
    const chunkPath = audioPath.replace(/\.[^/.]+$/, '') + `_chunk_${start}_${end}.wav`;
    
    return new Promise((resolve, reject) => {
      try {
        const ffmpeg = require('fluent-ffmpeg');
        const ffmpegPath = require('ffmpeg-static');
        ffmpeg.setFfmpegPath(ffmpegPath);
        
        ffmpeg(audioPath)
          .setStartTime(start)
          .setDuration(end - start)
          .outputOptions([
            '-vn',                // 映像を除去
            '-acodec pcm_s16le',  // PCM 16bit LEエンコード
            '-ar 16000',          // サンプルレート16kHz
            '-ac 1',              // モノラルチャンネル
            '-f wav'              // WAV形式
          ])
          .output(chunkPath)
          .on('end', () => {
            console.log(`チャンク抽出が完了しました: ${start}秒 - ${end}秒`);
            resolve(chunkPath);
          })
          .on('error', (err: unknown) => {
            console.error('チャンク抽出中にエラーが発生しました:', err);
            reject(err);
          })
          .run();
      } catch (error) {
        console.error('FFmpegの初期化に失敗しました:', error);
        reject(error);
      }
    });
  }

  // 音声チャンクを処理
  private async transcribeChunk(chunkPath: string, chunkNumber: number, totalChunks: number): Promise<string> {
    try {
      console.log(`チャンク${chunkNumber}/${totalChunks}の文字起こしを開始`);
      
      // 音声ファイルを読み込み
      const audioData = fs.readFileSync(chunkPath);
      
      // Geminiモデルの取得
      const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
      
      // プロンプトの作成（チャンク情報を含む）
      const prompt = `
      あなたは高精度文字起こしの専門家です。このファイルは実際にユーザーがアップロードした音声または動画データの一部（チャンク${chunkNumber}/${totalChunks}）です。

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
      - 音声が聞き取れない場合は「この部分の音声は聞き取れません」と正直に報告してください。
      - 音声が存在しない場合は「音声データが検出できません」と報告してください。
      - 架空の内容を生成することは厳禁です。これは実際のユーザーデータの文字起こしです。

      ## チャンク情報
      - これは${totalChunks}分割された音声の${chunkNumber}番目のチャンクです
      - 前後のチャンクとの連続性を意識してください
      - チャンクの先頭と末尾の文が途中で切れている可能性があります

      全ての言葉を省略せず、一言一句漏らさず文字起こしして下さい。
      `;
      
      // 音声データをBase64エンコード
      const base64Audio = audioData.toString('base64');
      
      // Gemini APIへのリクエスト
      const result = await model.generateContent([
        { text: prompt },
        {
          inlineData: {
            mimeType: 'audio/wav',
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
        console.warn(`警告: チャンク${chunkNumber}で架空のセミナー内容が検出されました`);
        return `[警告: チャンク${chunkNumber}で架空の内容が検出されました。このチャンクの音声は正しく処理できませんでした。]`;
      }
      
      console.log(`チャンク${chunkNumber}の文字起こしが完了しました`);
      return transcription;
    } catch (error) {
      console.error(`チャンク${chunkNumber}の処理中にエラーが発生しました:`, error);
      throw error;
    }
  }

  // ローカルファイルを処理する関数
  private async processLocalFile(audioPath: string): Promise<string> {
    let localFilePath = '';
    let tempDir = '';
    let tempFiles: string[] = [];
    
    try {
      console.log(`ローカルファイル処理を開始: ${audioPath}`);
      console.log(`[DEBUG] 処理するファイル情報: 存在=${fs.existsSync(audioPath)}, サイズ=${fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 'N/A'} バイト`);
      
      // 一時ディレクトリの作成
      tempDir = path.join(os.tmpdir(), 'transcription-' + crypto.randomBytes(6).toString('hex'));
      fs.mkdirSync(tempDir, { recursive: true });
      
      // ファイルのダウンロード
      localFilePath = await this.downloadFile(audioPath, tempDir);
      tempFiles.push(localFilePath);
      console.log(`ファイルのダウンロード完了: ${localFilePath}`);
      console.log(`[DEBUG] ダウンロードしたファイル情報: 存在=${fs.existsSync(localFilePath)}, サイズ=${fs.existsSync(localFilePath) ? fs.statSync(localFilePath).size : 'N/A'} バイト`);
      
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
        console.log(`[DEBUG] 抽出した音声ファイル情報: 存在=${fs.existsSync(audioFilePath)}, サイズ=${fs.existsSync(audioFilePath) ? fs.statSync(audioFilePath).size : 'N/A'} バイト`);
        
        // 音声ファイルのメタデータを取得（ffprobeを使用）
        try {
          const ffprobeOutput = execSync(`ffprobe -v error -show_format -show_streams "${audioFilePath}"`, { encoding: 'utf-8' });
          console.log(`[DEBUG] 音声ファイルのメタデータ:\n${ffprobeOutput}`);
        } catch (ffprobeError) {
          console.error(`[DEBUG] ffprobeエラー:`, ffprobeError);
        }
      }
      
      // Gemini APIを呼び出し
      console.log(`Gemini APIを呼び出します...`);
      
      // Gemini APIを使用して文字起こし
      const transcription = await this.transcribeWithGemini(audioFilePath);
      console.log(`Gemini APIでの文字起こしが成功しました`);
      console.log(`[DEBUG] Gemini結果の長さ: ${transcription.length} 文字`);
      console.log(`[DEBUG] Gemini結果の一部: ${transcription.substring(0, 100)}...`);
      
      // 結果を返す
      const finalTranscript = transcription;
      
      if (!finalTranscript || finalTranscript.trim().length === 0) {
        throw new Error('文字起こし結果が空です');
      }
      
      return finalTranscript;
    } catch (error) {
      console.error('ローカルファイル処理エラー:', error);
      throw error;
    }
  }
}
