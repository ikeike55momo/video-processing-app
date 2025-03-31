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
      // Cloudflare R2の公開URLの場合、直接バックエンドAPIを使用
      if (fileUrl.includes('r2.dev')) {
        console.log(`Cloudflare R2公開URL検出: ${fileUrl}`);

        // URLからバケット名とキーを抽出
        const urlParts = new URL(fileUrl);
        const pathParts = urlParts.pathname.split('/');
        const bucketName = 'video-processing'; // 固定値
        const key = pathParts.slice(1).join('/');

        console.log(`R2公開URL解析結果: バケット=${bucketName}, キー=${key}`);

        // 一時ディレクトリを作成
        const tempDir = path.join(os.tmpdir(), 'video-processing-' + crypto.randomBytes(6).toString('hex'));
        fs.mkdirSync(tempDir, { recursive: true });

        // ファイルをダウンロード
        const localPath = path.join(tempDir, path.basename(key));
        console.log(`公開URLからファイルをダウンロード中: ${localPath}`);

        const fileResponse = await fetch(fileUrl);
        const buffer = await fileResponse.arrayBuffer();
        fs.writeFileSync(localPath, Buffer.from(buffer));

        console.log(`公開URLからのダウンロード完了: ${localPath}`);
        console.log(`ファイルサイズ: ${(fs.statSync(localPath).size / (1024 * 1024)).toFixed(2)} MB`);

        // ファイル拡張子を確認
        const fileExt = path.extname(localPath).toLowerCase();
        console.log(`ファイル拡張子: ${fileExt}`);

        // 動画ファイルから音声データを抽出
        console.log(`動画ファイルから音声データを抽出します`);

        // ファイルサイズを確認
        const fileSize = fs.statSync(localPath).size;
        const fileSizeInMB = fileSize / (1024 * 1024);
        console.log(`ファイルサイズ: ${fileSizeInMB.toFixed(2)} MB`);
        
        // 大きなファイルの場合は分割処理
        if (fileSizeInMB > 50) {
          console.log(`ファイルサイズが大きいため（${fileSizeInMB.toFixed(2)} MB）、分割処理を行います`);
          return this.processLargeFile(localPath);
        }

        // メモリ使用量を表示
        console.log(`現在のメモリ使用量: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);

        // 音声データをBase64エンコード
        const audioData = fs.readFileSync(localPath);
        const base64Audio = audioData.toString('base64');
        console.log(`音声データをBase64エンコードしました (${base64Audio.length} 文字)`);

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

        // Gemini APIへのリクエスト
        console.log(`Gemini API (${this.geminiModel}) にリクエストを送信します...`);
        const result = await model.generateContent([
          { text: prompt },
          {
            inlineData: {
              mimeType: 'video/mp4',
              data: base64Audio
            }
          }
        ]);
        
        const responseText = await result.response;
        const transcription = responseText.text();

        console.log(`文字起こし完了`);

        // 一時ディレクトリを削除
        try {
          fs.rmdirSync(tempDir, { recursive: true });
        } catch (cleanupError) {
          console.error('一時ディレクトリの削除中にエラーが発生しました:', cleanupError);
        }

        return transcription;
      } else {
        // 以前の処理を実行
        // ここに元の処理コードを戻す必要があります
        throw new Error('非R2 URLの処理は現在サポートされていません');
      }
    } catch (error: any) {
      console.error('文字起こし処理エラー:', error);
      throw new Error(`文字起こし処理に失敗しました: ${error.message}`);
    }
  }

  /**
   * 大きなファイルを分割して処理
   * @param filePath ファイルパス
   * @returns 文字起こし結果
   */
  private async processLargeFile(filePath: string): Promise<string> {
    console.log(`大きなファイルの分割処理を開始: ${filePath}`);
    
    try {
      // メモリ使用量を表示
      console.log(`分割処理開始時のメモリ使用量: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
      
      // ファイルサイズを確認
      const fileSize = fs.statSync(filePath).size;
      const fileSizeInMB = fileSize / (1024 * 1024);
      
      // チャンクサイズを計算（最大30MB）
      const MAX_CHUNK_SIZE = 30 * 1024 * 1024; // 30MB
      const numChunks = Math.ceil(fileSize / MAX_CHUNK_SIZE);
      console.log(`ファイルを${numChunks}個のチャンクに分割します（各チャンク最大30MB）`);
      
      let transcriptionResults: string[] = [];
      
      // 各チャンクを処理
      for (let i = 0; i < numChunks; i++) {
        console.log(`チャンク ${i + 1}/${numChunks} を処理中...`);
        
        // チャンクの開始位置と長さを計算
        const start = i * MAX_CHUNK_SIZE;
        const end = Math.min((i + 1) * MAX_CHUNK_SIZE, fileSize);
        const chunkSize = end - start;
        
        // ファイルの一部を読み込む
        const chunkBuffer = Buffer.alloc(chunkSize);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, chunkBuffer, 0, chunkSize, start);
        fs.closeSync(fd);
        
        // Base64エンコード
        const base64Chunk = chunkBuffer.toString('base64');
        console.log(`チャンク ${i + 1} をBase64エンコードしました (${base64Chunk.length} 文字)`);
        
        // Geminiモデルの取得
        const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
        
        // プロンプトの作成（チャンク情報を追加）
        const prompt = `
        あなたは高精度文字起こしの専門家です。このファイルは実際にユーザーがアップロードした音声または動画データの一部（チャンク ${i + 1}/${numChunks}）です。

        ## 文字起こしの指示
        1. 全ての言葉を省略せず、一語一句正確に文字起こししてください
        2. 専門用語や固有名詞は特に注意して正確に書き起こしてください
        3. 話者を識別し、適切にラベル付けしてください（「話者A：」「話者B：」など）
        4. 聞き取れない部分は[不明]と記録してください
        5. 音声の特徴（笑い、ため息、強調など）も[笑い]のように記録してください
        6. 言い間違いや言い直しも忠実に書き起こしてください
        7. 句読点、改行を適切に入れて読みやすくしてください
        8. これはファイルの一部（チャンク ${i + 1}/${numChunks}）であることを念頭に置いてください

        ## 最重要指示
        - これは実際の文字起こしタスクです。架空の内容を絶対に生成しないでください。
        - 音声に実際に含まれている内容だけを文字起こししてください。
        - 音声が聞き取れない場合は「この部分は聞き取れません」と正直に報告してください。
        `;
        
        // Gemini APIへのリクエスト
        console.log(`チャンク ${i + 1} をGemini API (${this.geminiModel}) に送信します...`);
        const result = await model.generateContent([
          { text: prompt },
          {
            inlineData: {
              mimeType: 'audio/mp3',
              data: base64Chunk
            }
          }
        ]);
        
        const responseText = await result.response;
        const chunkTranscription = responseText.text();
        
        // 結果を配列に追加
        transcriptionResults.push(chunkTranscription);
        
        console.log(`チャンク ${i + 1} の文字起こしが完了しました`);
        
        // メモリを解放
        if (global.gc) {
          console.log(`チャンク ${i + 1} 処理後にガベージコレクションを実行します`);
          global.gc();
        }
        
        // メモリ使用量を表示
        console.log(`チャンク ${i + 1} 処理後のメモリ使用量: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
      }
      
      // 全てのチャンクの結果を結合
      const fullTranscription = transcriptionResults.join('\n\n');
      console.log(`全チャンクの文字起こしが完了しました。合計 ${fullTranscription.length} 文字`);
      
      return fullTranscription;
    } catch (error) {
      console.error('大きなファイルの分割処理中にエラーが発生しました:', error);
      throw error;
    }
  }

  // ...
}
