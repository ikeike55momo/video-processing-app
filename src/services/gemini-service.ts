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
    
    // 環境変数からモデル名を取得（デフォルトはgemini-2.0-flash）
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
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
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
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
          .on('error', (err: Error) => {
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
          .on('error', (err: Error) => {
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
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
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
      
      ## 最重要指示
      - 提供されたテキストの内容だけを要約してください
      - 架空の内容を追加したり、存在しない情報を生成したりしないでください
      - 「AIスクールセミナー」や「LLMを活用した文字起こし」などの架空のセミナー内容を生成しないでください
      - 元のテキストに存在しない内容を追加しないでください
      - テキストが空や無意味な場合は「有効なコンテンツが検出できません」と報告してください
      
      文字起こしテキスト:
      ${transcription}
      `;
      
      // Gemini APIへのリクエスト
      const result = await model.generateContent([
        { text: prompt }
      ]);
      
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
