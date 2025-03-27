import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import axios from 'axios';
import { pipeline } from 'stream/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * 高精度文字起こしサービス
 * Gemini Flashを使用して高精度な文字起こしを実現
 */
export class TranscriptionService {
  private genAI: GoogleGenerativeAI;
  private geminiModel: string;
  private s3Client: any;

  constructor() {
    // APIキーの取得
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY環境変数が設定されていません');
    }

    // Gemini APIの初期化
    this.genAI = new GoogleGenerativeAI(geminiApiKey);
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

    // S3クライアントの初期化
    this.s3Client = new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    });

    console.log('TranscriptionService初期化完了');
  }

  /**
   * 音声ファイルを文字起こし
   * @param fileUrl 音声/動画ファイルのURL
   * @returns 文字起こし結果
   */
  async transcribeFile(fileUrl: string): Promise<string> {
    console.log(`文字起こし処理を開始: ${fileUrl}`);
    
    try {
      // ファイルをダウンロード
      const tempDir = path.join(os.tmpdir(), 'transcription-' + crypto.randomBytes(6).toString('hex'));
      fs.mkdirSync(tempDir, { recursive: true });
      
      console.log(`一時ディレクトリを作成しました: ${tempDir}`);
      
      // ファイルをダウンロード
      const filePath = await this.downloadFile(fileUrl, tempDir);
      console.log(`ファイルをダウンロードしました: ${filePath}`);
      
      // 音声ファイルを最適化
      console.log(`音声ファイルの最適化を開始します...`);
      const optimizedAudioPath = await this.optimizeAudioForGemini(filePath);
      console.log(`音声ファイルを最適化しました: ${optimizedAudioPath}`);
      
      // 音声ファイルのサイズを確認
      const stats = fs.statSync(optimizedAudioPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      console.log(`最適化された音声ファイルのサイズ: ${fileSizeMB.toFixed(2)} MB`);
      
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
        console.log(`Gemini API (${this.geminiModel}) にリクエストを送信します...`);
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
        
        // 文字起こし結果の検証
        if (!transcription || transcription.trim() === '') {
          console.error('エラー: Gemini APIから空の文字起こし結果が返されました');
          throw new Error('文字起こし結果が空です。音声データが正しく処理されませんでした。');
        }
        
        console.log(`文字起こし結果を受信しました (${transcription.length} 文字)`);
        console.log(`文字起こし結果の先頭100文字: ${transcription.substring(0, 100)}...`);
      }
      
      // 架空のセミナー内容が含まれていないか確認
      if (transcription.includes('AIスクール') || 
          transcription.includes('LLMの基礎') || 
          transcription.includes('セミナー要約') ||
          transcription.includes('AIを活用して人生を変えた')) {
        console.warn('警告: 架空のセミナー内容が検出されました。文字起こし結果を破棄します。');
        throw new Error('Gemini APIが架空の内容を生成しました。実際の音声データを文字起こしできませんでした。音声データが破損しているか、処理できない形式である可能性があります。');
      }
      
      // 文字起こし結果が実際の音声データであるかの追加検証
      if (transcription.includes('元の文字起こしテキストが提供されていない') ||
          transcription.includes('音声データが検出できません') ||
          transcription.includes('この音声は聞き取れません') ||
          transcription.includes('音声データが不完全または破損')) {
        console.error('エラー: 文字起こし結果が無効です:', transcription);
        throw new Error('音声データを正しく処理できませんでした。音声ファイルが破損しているか、処理できない形式である可能性があります。');
      }
      
      // 一時ファイルを削除
      try {
        this.cleanupAllTempFiles();
        console.log('一時ファイルを削除しました');
      } catch (cleanupError) {
        console.warn('一時ファイルの削除に失敗しました:', cleanupError);
      }
      
      return transcription;
    } catch (error: any) {
      console.error('文字起こし処理エラー:', error);
      throw new Error(`文字起こし処理に失敗しました: ${error.message}`);
    }
  }

  /**
   * 大きな音声ファイルを分割して文字起こしを行う
   * @param audioPath 音声ファイルのパス
   * @returns 文字起こし結果
   */
  private async transcribeWithGeminiChunked(audioPath: string): Promise<string> {
    try {
      console.log(`大きな音声ファイルを分割して処理します: ${audioPath}`);
      
      // 一時ディレクトリを作成
      const tempDir = path.join(os.tmpdir(), 'transcription-chunks-' + crypto.randomBytes(6).toString('hex'));
      fs.mkdirSync(tempDir, { recursive: true });
      
      // 音声ファイルを5分（300秒）ごとに分割
      const CHUNK_DURATION = 300; // 5分
      const outputPattern = path.join(tempDir, 'chunk_%03d.wav');
      
      await this.splitAudioFile(audioPath, outputPattern, CHUNK_DURATION);
      
      // 分割されたファイルを取得
      const chunkFiles = fs.readdirSync(tempDir)
        .filter(file => file.startsWith('chunk_') && file.endsWith('.wav'))
        .sort(); // 名前順にソート
      
      console.log(`音声ファイルを${chunkFiles.length}個のチャンクに分割しました`);
      
      // 各チャンクを処理
      const transcriptions: string[] = [];
      for (let i = 0; i < chunkFiles.length; i++) {
        const chunkPath = path.join(tempDir, chunkFiles[i]);
        console.log(`チャンク ${i+1}/${chunkFiles.length} を処理中: ${chunkPath}`);
        
        // 音声ファイルを読み込み
        const audioData = fs.readFileSync(chunkPath);
        const audioBase64 = audioData.toString('base64');
        
        // チャンク用のプロンプトを作成（前後の文脈を考慮するよう指示）
        let contextPrompt = '';
        if (i > 0) {
          contextPrompt = `\n\nこれは長い音声の${i+1}番目のチャンクです。前のチャンクの続きから文字起こしを行ってください。`;
        }
        
        // Gemini APIで文字起こし
        try {
          const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
          
          // プロンプトを作成
          const promptText = `あなたは高精度文字起こしの専門家です。このファイルは実際にユーザーがアップロードした音声または動画データです。

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
          ${contextPrompt}`;
          
          // 音声データを含むリクエストを作成
          const result = await model.generateContent([
            { text: promptText },
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: audioBase64
              }
            }
          ]);
          
          const response = result.response;
          const text = response.text();
          
          // 文字起こし結果の検証
          if (!text || text.trim() === '') {
            console.warn(`チャンク ${i+1} の文字起こし結果が空です。スキップします。`);
            continue;
          }
          
          // 架空のセミナー内容が含まれていないか確認
          if (text.includes('AIスクール') || 
              text.includes('LLMの基礎') || 
              text.includes('セミナー要約')) {
            console.warn(`チャンク ${i+1} に架空のセミナー内容が検出されました。スキップします。`);
            continue;
          }
          
          transcriptions.push(text);
          console.log(`チャンク ${i+1} の文字起こしが完了しました (${text.length} 文字)`);
        } catch (error) {
          console.error(`チャンク ${i+1} の処理中にエラーが発生しました:`, error);
          // エラーが発生しても処理を続行
        }
      }
      
      // 一時ディレクトリを削除
      try {
        this.removeDirectoryRecursive(tempDir);
        console.log(`一時ディレクトリを削除しました: ${tempDir}`);
      } catch (err) {
        console.error(`一時ディレクトリの削除に失敗しました: ${tempDir}`, err);
      }
      
      // 結果を結合
      const combinedTranscription = transcriptions.join('\n\n');
      console.log(`全チャンクの文字起こしが完了しました (合計 ${combinedTranscription.length} 文字)`);
      
      return combinedTranscription;
    } catch (error: any) {
      console.error('チャンク処理中にエラーが発生しました:', error);
      throw new Error(`チャンク処理に失敗しました: ${error.message}`);
    }
  }

  /**
   * 音声ファイルを指定した長さのチャンクに分割する
   * @param inputPath 入力音声ファイルのパス
   * @param outputPattern 出力パターン（例: /path/to/chunk_%03d.wav）
   * @param chunkDuration チャンクの長さ（秒）
   */
  private async splitAudioFile(inputPath: string, outputPattern: string, chunkDuration: number): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`音声ファイルを分割: ${inputPath} -> ${outputPattern} (${chunkDuration}秒ごと)`);
      
      const ffmpeg = require('fluent-ffmpeg');
      const ffmpegPath = require('ffmpeg-static');
      ffmpeg.setFfmpegPath(ffmpegPath);
      
      ffmpeg(inputPath)
        .outputOptions([
          '-f segment',
          '-segment_time ' + chunkDuration,
          '-c:a pcm_s16le',
          '-ar 16000',
          '-ac 1'
        ])
        .output(outputPattern)
        .on('end', () => {
          console.log('音声ファイルの分割が完了しました');
          resolve();
        })
        .on('error', (err: unknown) => {
          console.error('音声ファイルの分割中にエラーが発生しました:', err);
          reject(err);
        })
        .run();
    });
  }

  /**
   * ディレクトリを再帰的に削除する関数
   * @param dirPath 削除するディレクトリのパス
   */
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

  /**
   * 一時ファイルをすべて削除する
   */
  private async cleanupAllTempFiles(): Promise<void> {
    try {
      const tempDir = path.join(os.tmpdir(), 'transcription-*');
      const files = fs.readdirSync(os.tmpdir());
      files.forEach((file) => {
        if (file.startsWith('transcription-')) {
          const filePath = path.join(os.tmpdir(), file);
          this.removeDirectoryRecursive(filePath);
        }
      });
    } catch (err) {
      console.error('一時ファイルの削除中にエラーが発生しました:', err);
    }
  }

  /**
   * 音声ファイルをGemini APIに最適な形式に変換する
   * @param audioPath 音声ファイルのパス
   * @returns 最適化された音声ファイルのパス
   */
  private async optimizeAudioForGemini(audioPath: string): Promise<string> {
    try {
      console.log(`音声ファイルを最適化します: ${audioPath}`);
      
      // 出力パスを設定
      const outputPath = `${audioPath}_optimized.wav`;
      
      // ファイル拡張子を確認
      const fileExt = path.extname(audioPath).toLowerCase();
      
      // 動画ファイルの場合は音声を抽出
      if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(fileExt)) {
        console.log('動画ファイルから音声を抽出します');
        const extractedAudioPath = `${audioPath}_audio.mp3`;
        await this.extractAudioFromVideo(audioPath, extractedAudioPath);
        
        // 抽出した音声ファイルをWAVに変換
        await this.convertAudioToWav(extractedAudioPath, outputPath);
        
        // 一時ファイルを削除
        try {
          fs.unlinkSync(extractedAudioPath);
          console.log(`一時音声ファイルを削除しました: ${extractedAudioPath}`);
        } catch (err) {
          console.error(`一時音声ファイルの削除に失敗しました: ${extractedAudioPath}`, err);
        }
      } else if (['.mp3', '.ogg', '.flac'].includes(fileExt)) {
        // 音声ファイルの場合はWAVに変換
        console.log('音声ファイルをWAVに変換します');
        await this.convertAudioToWav(audioPath, outputPath);
      } else if (fileExt === '.wav') {
        // すでにWAVファイルの場合は最適化のみ
        console.log('WAVファイルを最適化します');
        await this.convertAudioToWav(audioPath, outputPath);
      } else {
        console.log(`未サポートのファイル形式です: ${fileExt}、そのまま処理します`);
        return audioPath;
      }
      
      // 最適化されたファイルが存在するか確認
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        console.log(`音声ファイルの最適化が完了しました: ${outputPath}`);
        return outputPath;
      } else {
        console.error(`最適化されたファイルが存在しないか、サイズが0です: ${outputPath}`);
        return audioPath; // 元のファイルを返す
      }
    } catch (error) {
      console.error('音声ファイルの最適化中にエラーが発生しました:', error);
      return audioPath; // エラーが発生した場合は元のファイルを返す
    }
  }

  /**
   * 動画から音声を抽出
   * @param videoPath 動画ファイルのパス
   * @param outputPath 出力音声ファイルのパス
   */
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

  /**
   * 音声ファイルをWAVに変換する関数
   * @param inputPath 入力音声ファイルのパス
   * @param outputPath 出力WAVファイルのパス
   */
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

  /**
   * ファイルURLからファイルをダウンロード
   * @param fileUrl ファイルのURL
   * @param tempDir 一時ディレクトリのパス
   * @returns ダウンロードしたファイルのパス
   */
  private async downloadFile(fileUrl: string, tempDir: string): Promise<string> {
    // R2バケット名
    const r2BucketName = process.env.R2_BUCKET_NAME || 'video-processing';
    
    let key = '';
    
    try {
      // URLの形式に応じた処理
      if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        if (!fileUrl.includes('r2.cloudflarestorage.com') && !fileUrl.includes('cloudflare')) {
          // 公開URLの場合、一時ファイルにダウンロード
          console.log('公開URLからファイルをダウンロードします');
          
          // ファイルをダウンロード
          const localFilePath = path.join(tempDir, 'audio' + path.extname(fileUrl) || '.mp3');
          console.log(`ファイルをダウンロード中: ${localFilePath}`);
          
          const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream'
          });
          
          await pipeline(
            response.data,
            fs.createWriteStream(localFilePath)
          );
          
          console.log(`ファイルのダウンロード完了: ${localFilePath}`);
          return localFilePath;
        }
      }
      
      // R2の完全なURLの場合
      if (fileUrl.includes('r2.cloudflarestorage.com')) {
        // R2の完全なURLからキーを抽出
        const urlObj = new URL(fileUrl);
        const pathParts = urlObj.pathname.split('/');
        // 最初の空の部分とバケット名を除去
        pathParts.shift(); // 先頭の空文字を削除
        if (pathParts[0] === r2BucketName) {
          pathParts.shift(); // バケット名を削除
        }
        key = pathParts.join('/');
        console.log(`R2 URL解析結果: キー=${key}`);
      } 
      // 従来のGCS形式のURLからキーを抽出（互換性のため）
      else if (fileUrl.startsWith('gs://')) {
        const gcsMatch = fileUrl.match(/gs:\/\/([^\/]+)\/(.+)/);
        if (!gcsMatch) {
          throw new Error('無効なファイルURL形式です: ' + fileUrl);
        }
        key = gcsMatch[2];
        console.log(`GCS URL解析結果: キー=${key}`);
      }
      // アップロードされたファイルの場合（uploads/timestamp-filename形式）
      else if (fileUrl.includes('uploads/')) {
        // キーをそのまま使用
        key = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
        console.log(`アップロードファイル解析結果: キー=${key}`);
      }
      // 通常のパス形式の場合
      else {
        key = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
        console.log(`通常パス解析結果: キー=${key}`);
      }
      
      console.log(`R2からファイルを取得: キー=${key}`);
      
      // ファイルをダウンロード
      const localFilePath = path.join(tempDir, path.basename(key));
      console.log(`ファイルをダウンロード中: ${localFilePath} (キー: ${key})`);
      
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
      
      console.log(`ファイルのダウンロード完了: ${localFilePath}`);
      return localFilePath;
    } catch (error: any) {
      console.error('ファイルダウンロードエラー:', error);
      throw new Error(`ファイルのダウンロードに失敗しました: ${error.message}`);
    }
  }
}
