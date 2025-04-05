import { GoogleGenerativeAI } from '@google/generative-ai';
import * as crypto from 'crypto';
import axios from 'axios';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ブラウザ環境用のpath代替関数
const pathBasename = (filepath: string) => {
  return filepath.split('/').pop() || filepath;
};

const pathExtname = (filepath: string) => {
  const parts = filepath.split('.');
  return parts.length > 1 ? `.${parts.pop()}` : '';
};

/**
 * Gemini AIサービスクラス
 */
export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: string;
  private s3Client: any;

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
    
    // Cloudflare R2の初期化
    try {
      const r2Endpoint = process.env.R2_ENDPOINT;
      const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
      const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
      
      if (!r2Endpoint || !r2AccessKeyId || !r2SecretAccessKey) {
        throw new Error('R2の環境変数（R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY）が設定されていません');
      }
      
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: r2Endpoint,
        credentials: {
          accessKeyId: r2AccessKeyId,
          secretAccessKey: r2SecretAccessKey
        }
      });
    } catch (error) {
      console.error('Cloudflare R2初期化エラー:', error);
      // 開発環境では仮のクライアントオブジェクトを作成
      if (process.env.NODE_ENV === 'development') {
        console.warn('開発環境用の仮のR2クライアントオブジェクトを使用します');
        this.s3Client = new S3Client({
          region: 'auto',
          endpoint: 'https://example.com',
          credentials: {
            accessKeyId: 'dummy',
            secretAccessKey: 'dummy'
          }
        });
      } else {
        throw new Error('Cloudflare R2の初期化に失敗しました: ' + (error instanceof Error ? error.message : '不明なエラー'));
      }
    }
    
    console.log(`Geminiモデルを初期化: ${this.model}`);
  }

  /**
   * 文字起こし処理
   * @param fileUrl ファイルのURL
   * @returns 文字起こし結果
   */
  async transcribeAudio(fileUrl: string): Promise<string> {
    console.log(`文字起こし処理を開始: ${fileUrl}`);
    
    try {
      // URLからバケット名とキーを抽出
      let bucketName: string;
      let key: string;
      
      // R2のURLからバケット名とキーを抽出
      const r2BucketName = process.env.R2_BUCKET_NAME || 'video-processing';
      
      // Cloudflare R2の公開URLの場合（pub-で始まるドメイン）
      if (fileUrl.includes('pub-') && fileUrl.includes('.r2.dev')) {
        console.log(`Cloudflare R2公開URL検出: ${fileUrl}`);
        bucketName = r2BucketName;
        
        // URLからパスを抽出
        const urlObj = new URL(fileUrl);
        // パスの先頭の/を削除
        key = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
        
        console.log(`R2公開URL解析結果: バケット=${bucketName}, キー=${key}`);
        
        // 公開URLの場合は直接ダウンロード
        try {
          // 一時ディレクトリを作成
          const tempDir = URL.createObjectURL(new Blob());
          const localFilePath = `${tempDir}/${pathBasename(key)}`;
          console.log(`公開URLからファイルをダウンロード中: ${localFilePath}`);
          
          const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'blob'
          });
          
          const file = new File([response.data], pathBasename(key), { type: response.data.type });
          const objectUrl = URL.createObjectURL(file);
          const fileObject = await fetch(objectUrl).then(response => response.blob());
          const fileBuffer = await fileObject.arrayBuffer();
          const fileArray = new Uint8Array(fileBuffer);
          
          console.log(`公開URLからのダウンロード完了: ${localFilePath}`);
          
          // ファイルサイズを確認
          const fileSizeInMB = fileArray.length / (1024 * 1024);
          console.log(`ファイルサイズ: ${fileSizeInMB.toFixed(2)} MB`);
          
          // ファイル拡張子を確認
          const fileExt = pathExtname(localFilePath).toLowerCase();
          console.log(`ファイル拡張子: ${fileExt}`);
          
          // 大きなファイルの場合は分割処理
          if (fileSizeInMB > 50) {
            console.log(`ファイルサイズが大きいため（${fileSizeInMB.toFixed(2)} MB）、分割処理を行います`);
            return await this.processLargeFile(fileArray, fileExt);
          }
          
          // ファイルの種類に応じた処理
          let audioData: Uint8Array;
          let mimeType: string;
          
          if (['.mp3', '.wav', '.ogg'].includes(fileExt)) {
            // 音声ファイルの場合はそのまま処理
            console.log('音声ファイルを直接処理します');
            audioData = fileArray;
            
            // MIMEタイプを設定
            if (fileExt === '.mp3') {
              mimeType = 'audio/mpeg';
            } else if (fileExt === '.wav') {
              mimeType = 'audio/wav';
            } else {
              mimeType = 'audio/ogg';
            }
          } else {
            // 動画ファイルの場合は先頭部分のみを処理（音声データとして扱う）
            console.log('動画ファイルから音声データを抽出します');
            
            // ファイルの先頭10MBを読み込む（ヘッダー部分を避けるため）
            const AUDIO_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
            const fileSize = fileArray.length;
            const readSize = Math.min(AUDIO_CHUNK_SIZE, fileSize);
            
            // ファイルの先頭部分を読み込む
            audioData = fileArray.slice(0, readSize);
            
            // 音声ファイルとして扱うためのMIMEタイプを設定
            mimeType = 'audio/mpeg'; // mp3として扱う
          }
          
          // Base64エンコード
          const audioBase64 = this.arrayBufferToBase64(audioData);
          console.log(`音声データをBase64エンコードしました (${audioBase64.length} 文字)`);
          
          // 文字起こし処理
          const transcript = await this.processAudioWithMimeType(audioBase64, mimeType);
          
          console.log('文字起こし完了');
          
          return transcript;
        } catch (downloadError: any) {
          console.error('公開URLからのダウンロードエラー:', downloadError);
          throw new Error(`公開URLからのダウンロードに失敗しました: ${downloadError.message}`);
        }
      }
      // R2の完全なURLの場合
      else if (fileUrl.includes('r2.cloudflarestorage.com')) {
        // R2の完全なURLからキーを抽出
        const urlObj = new URL(fileUrl);
        const pathParts = urlObj.pathname.split('/');
        // 最初の空の部分とバケット名を除去
        pathParts.shift(); // 先頭の空文字を削除
        if (pathParts[0] === r2BucketName) {
          pathParts.shift(); // バケット名を削除
        }
        key = pathParts.join('/');
        bucketName = r2BucketName;
        console.log(`R2 URL解析結果: バケット=${bucketName}, キー=${key}`);
      } 
      // 従来のGCS形式のURLからキーを抽出（互換性のため）
      else if (fileUrl.startsWith('gs://')) {
        const gcsMatch = fileUrl.match(/gs:\/\/([^\/]+)\/(.+)/);
        if (!gcsMatch) {
          throw new Error('無効なファイルURL形式です: ' + fileUrl);
        }
        bucketName = r2BucketName;
        key = gcsMatch[2];
        console.log(`GCS URL解析結果: バケット=${bucketName}, キー=${key}`);
      }
      // アップロードされたファイルの場合（uploads/timestamp-filename形式）
      else if (fileUrl.includes('uploads/')) {
        bucketName = r2BucketName;
        // キーをそのまま使用
        key = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
        console.log(`アップロードファイル解析結果: バケット=${bucketName}, キー=${key}`);
      }
      // 通常のパス形式の場合
      else {
        bucketName = r2BucketName;
        key = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
        console.log(`通常パス解析結果: バケット=${bucketName}, キー=${key}`);
      }
      
      console.log(`R2からファイルを取得: バケット=${bucketName}, キー=${key}`);
      
      // 一時ディレクトリを作成
      const tempDir = URL.createObjectURL(new Blob());
      const localFilePath = `${tempDir}/${pathBasename(key)}`;
      console.log(`ファイルをダウンロード中: ${localFilePath} (バケット: ${bucketName}, キー: ${key})`);
      
      // 署名付きURLを生成
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      });
      
      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
      console.log(`署名付きURL生成: ${signedUrl.substring(0, 100)}...`);
      
      const response = await axios({
        method: 'get',
        url: signedUrl,
        responseType: 'blob'
      });
      
      const file = new File([response.data], pathBasename(key), { type: response.data.type });
      const objectUrl = URL.createObjectURL(file);
      const fileObject = await fetch(objectUrl).then(response => response.blob());
      const fileBuffer = await fileObject.arrayBuffer();
      const fileArray = new Uint8Array(fileBuffer);
      
      console.log(`ファイルのダウンロード完了: ${localFilePath}`);
      
      // ファイルサイズを確認
      const fileSizeInMB = fileArray.length / (1024 * 1024);
      console.log(`ファイルサイズ: ${fileSizeInMB.toFixed(2)} MB`);
      
      // ファイル拡張子を確認
      const fileExt = pathExtname(localFilePath).toLowerCase();
      console.log(`ファイル拡張子: ${fileExt}`);
      
      // 大きなファイルの場合は分割処理
      if (fileSizeInMB > 50) {
        console.log(`ファイルサイズが大きいため（${fileSizeInMB.toFixed(2)} MB）、分割処理を行います`);
        return await this.processLargeFile(fileArray, fileExt);
      }
      
      // ファイルの種類に応じた処理
      let audioData: Uint8Array;
      let mimeType: string;
      
      if (['.mp3', '.wav', '.ogg'].includes(fileExt)) {
        // 音声ファイルの場合はそのまま処理
        console.log('音声ファイルを直接処理します');
        audioData = fileArray;
        
        // MIMEタイプを設定
        if (fileExt === '.mp3') {
          mimeType = 'audio/mpeg';
        } else if (fileExt === '.wav') {
          mimeType = 'audio/wav';
        } else {
          mimeType = 'audio/ogg';
        }
      } else {
        // 動画ファイルの場合は先頭部分のみを処理（音声データとして扱う）
        console.log('動画ファイルから音声データを抽出します');
        
        // ファイルの先頭10MBを読み込む（ヘッダー部分を避けるため）
        const AUDIO_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
        const fileSize = fileArray.length;
        const readSize = Math.min(AUDIO_CHUNK_SIZE, fileSize);
        
        // ファイルの先頭部分を読み込む
        audioData = fileArray.slice(0, readSize);
        
        // 音声ファイルとして扱うためのMIMEタイプを設定
        mimeType = 'audio/mpeg'; // mp3として扱う
      }
      
      // Base64エンコード
      const audioBase64 = this.arrayBufferToBase64(audioData);
      console.log(`音声データをBase64エンコードしました (${audioBase64.length} 文字)`);
      
      // 文字起こし処理
      const transcript = await this.processAudioWithMimeType(audioBase64, mimeType);
      
      console.log('文字起こし完了');
      
      return transcript;
    } catch (error: any) {
      console.error('文字起こしエラー:', error);
      throw new Error(`文字起こし処理に失敗しました: ${error.message}`);
    }
  }
  
  /**
   * 大きなファイルを分割して処理
   * @param fileArray ファイルデータ
   * @param fileExt ファイル拡張子
   * @returns 文字起こし結果
   */
  private async processLargeFile(fileArray: Uint8Array, fileExt: string): Promise<string> {
    console.log(`大きなファイルの分割処理を開始: ${fileArray.length} bytes`);
    
    try {
      // メモリ使用量を表示
      console.log(`分割処理開始時のメモリ使用量: ${Math.round(window.performance.now() / 1024 / 1024)} MB`);
      
      // ファイルサイズを確認
      const fileSizeInMB = fileArray.length / (1024 * 1024);
      
      // 動画ファイルの場合は時間ベースでチャンク分割（3〜4分程度）
      // 音声ファイルの場合はサイズベースでチャンク分割
      let chunkDurationSeconds = 180; // 3分 = 180秒
      let estimatedDuration = 0;
      
      // 動画/音声ファイルの推定時間を計算
      // 一般的な動画ファイルの場合、1分あたり約10MBと仮定
      if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(fileExt)) {
        estimatedDuration = fileSizeInMB / 10 * 60; // 秒単位
        console.log(`動画ファイルの推定時間: 約${Math.round(estimatedDuration / 60)}分`);
      } 
      // 音声ファイルの場合、1分あたり約1MBと仮定
      else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(fileExt)) {
        estimatedDuration = fileSizeInMB / 1 * 60; // 秒単位
        console.log(`音声ファイルの推定時間: 約${Math.round(estimatedDuration / 60)}分`);
      }
      // その他のファイルはサイズベースで分割
      else {
        estimatedDuration = fileSizeInMB * 6; // 仮の時間（1MBあたり6秒と仮定）
        console.log(`ファイルの推定時間: 約${Math.round(estimatedDuration / 60)}分（推定）`);
      }
      
      // チャンク数を計算（3分ごとに分割）
      const numChunks = Math.max(1, Math.ceil(estimatedDuration / chunkDurationSeconds));
      
      // チャンクサイズを計算
      const chunkSize = Math.ceil(fileArray.length / numChunks);
      console.log(`ファイルを${numChunks}個のチャンクに分割します（各チャンク約3分、${Math.round(chunkSize / (1024 * 1024))}MB）`);
      
      // MIMEタイプを設定
      let mimeType: string;
      if (fileExt === '.mp3') {
        mimeType = 'audio/mpeg';
      } else if (fileExt === '.wav') {
        mimeType = 'audio/wav';
      } else if (fileExt === '.ogg') {
        mimeType = 'audio/ogg';
      } else {
        // 動画ファイルの場合はmp3として扱う
        mimeType = 'audio/mpeg';
      }
      
      // 並列処理のための配列
      const transcriptionPromises: Promise<{ index: number; text: string }>[] = [];
      
      // 各チャンクを処理
      for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min((i + 1) * chunkSize, fileArray.length);
        
        // チャンク処理関数
        const processChunk = async (): Promise<{ index: number; text: string }> => {
          console.log(`チャンク ${i + 1}/${numChunks} を処理中...`);
          
          // ファイルの一部を読み込む
          const chunkBuffer = fileArray.slice(start, end);
          
          // Base64エンコード
          const base64Chunk = this.arrayBufferToBase64(chunkBuffer);
          console.log(`チャンク ${i + 1} をBase64エンコードしました (${base64Chunk.length} 文字)`);
          
          // Geminiモデルの取得
          const model = this.genAI.getGenerativeModel({ model: this.model });
          
          // プロンプトの作成（チャンク情報を追加）
          const prompt = `
          あなたは高精度文字起こしの専門家です。このファイルは実際にユーザーがアップロードした音声または動画データの一部（チャンク ${i + 1}/${numChunks}）です。

          ## 文字起こしの指示
          1. 全ての言葉を省略せず、一語一句正確に文字起こししてください
          2. 専門用語や固有名詞のスペルや表記を統一し、正確にしてください
          3. 話者の区別を明確にし、一貫性のある形式で表示してください（例：「話者A：」「話者B：」など）
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
          console.log(`チャンク ${i + 1} をGemini API (${this.model}) に送信します...`);
          try {
            const result = await model.generateContent([
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Chunk
                }
              }
            ]);
            
            const responseText = await result.response;
            const chunkTranscription = responseText.text();
            
            console.log(`チャンク ${i + 1} の文字起こしが完了しました`);
            return { index: i, text: chunkTranscription };
          } catch (chunkError) {
            console.error(`チャンク ${i + 1} の処理中にエラーが発生しました:`, chunkError);
            
            // エラー発生時は少し待機してリトライ
            console.log(`チャンク ${i + 1} の処理に失敗しました。5秒後にリトライします...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            try {
              console.log(`チャンク ${i + 1} をリトライします...`);
              const retryResult = await model.generateContent([
                { text: prompt },
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: base64Chunk
                  }
                }
              ]);
              
              const retryResponseText = await retryResult.response;
              const retryChunkTranscription = retryResponseText.text();
              
              console.log(`チャンク ${i + 1} のリトライが成功しました`);
              return { index: i, text: retryChunkTranscription };
            } catch (retryError) {
              console.error(`チャンク ${i + 1} のリトライにも失敗しました:`, retryError);
              return { index: i, text: `[チャンク ${i + 1} の処理中にエラーが発生しました]` };
            }
          } finally {
            // メモリ使用量を表示
            console.log(`チャンク ${i + 1} 処理後のメモリ使用量: ${Math.round(window.performance.now() / 1024 / 1024)} MB`);
          }
        };
        
        // 並列処理のためにPromiseを追加
        transcriptionPromises.push(processChunk());
        
        // APIレート制限対策として少し待機
        if (i < numChunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // 並列処理の実行（最大3つまで同時実行）
      console.log(`${transcriptionPromises.length}個のチャンクを並列処理します...`);
      
      // 並列処理の結果を格納する配列
      const transcriptionResults: string[] = new Array(numChunks).fill('');
      
      // 並列処理を制限して実行
      const CONCURRENT_LIMIT = 3;
      for (let i = 0; i < transcriptionPromises.length; i += CONCURRENT_LIMIT) {
        const batch = transcriptionPromises.slice(i, i + CONCURRENT_LIMIT);
        const batchResults = await Promise.all(batch);
        
        // 結果を正しい位置に格納
        for (const result of batchResults) {
          transcriptionResults[result.index] = result.text;
        }
        
        // バッチ間で待機（APIレート制限対策とメモリ解放のため）
        if (i + CONCURRENT_LIMIT < transcriptionPromises.length) {
          console.log('次のバッチ処理前に5秒間待機します...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      // 全てのチャンクの結果を結合
      const fullTranscription = transcriptionResults.join('\n\n');
      console.log(`全チャンクの文字起こしが完了しました。合計 ${fullTranscription.length} 文字`);
      
      return fullTranscription;
    } catch (error) {
      console.error('大きなファイルの分割処理中にエラーが発生しました:', error);
      throw error;
    } finally {
      // 最終的なメモリ解放
      // TypeScriptエラーを回避するため、anyにキャスト
      (fileArray as any) = null;
      
      // 明示的にガベージコレクションを促す
      try {
        if (typeof window !== 'undefined' && (window as any).gc) {
          console.log('処理完了後にガベージコレクションを実行します');
          (window as any).gc();
        }
      } catch (e) {
        console.log('ガベージコレクション実行中にエラーが発生しました:', e);
      }
      
      console.log(`処理完了後のメモリ使用量: ${Math.round(window.performance.now() / 1024 / 1024)} MB`);
    }
  }

  /**
   * 音声チャンクを処理する
   * @param audioBase64 Base64エンコードされた音声データ
   * @returns 文字起こし結果
   */
  private async processAudioChunk(audioBase64: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
      // プロンプトを作成
      const promptText = this.createTranscriptionPrompt();
      
      // 音声データを含むリクエストを作成
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: promptText },
              { inlineData: { mimeType: 'audio/mp3', data: audioBase64 } }
            ]
          }
        ]
      });
      
      const response = await result.response;
      const text = response.text();
      
      return text;
    } catch (error: any) {
      console.error('音声チャンク処理エラー:', error);
      throw new Error(`音声チャンク処理に失敗しました: ${error.message}`);
    }
  }
  
  /**
   * MIMEタイプを指定して音声を処理する
   * @param audioBase64 Base64エンコードされた音声データ
   * @param mimeType MIMEタイプ
   * @returns 文字起こし結果
   */
  private async processAudioWithMimeType(audioBase64: string, mimeType: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
      // プロンプトを作成
      const promptText = this.createTranscriptionPrompt();
      
      // 音声データを含むリクエストを作成
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: promptText },
              { inlineData: { mimeType: mimeType, data: audioBase64 } }
            ]
          }
        ]
      });
      
      const response = await result.response;
      const text = response.text();
      
      return text;
    } catch (error: any) {
      console.error('音声処理エラー:', error);
      throw new Error(`音声処理に失敗しました: ${error.message}`);
    }
  }

  /**
   * 文字起こし結果の整形・改善処理
   * @param text 文字起こし結果のテキスト
   * @returns 整形・改善されたテキスト
   */
  async enhanceTranscript(text: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
      const prompt = `あなたは文字起こしデータの整形と改善を行う専門家です。以下の文字起こしテキストを整形・改善してください。

## 整形・改善の指示
1. 話者の区別を明確にし、一貫性のある形式で表示してください（例：「話者A：」「話者B：」など）
2. 専門用語や固有名詞のスペルや表記を統一し、正確にしてください
3. 文脈から明らかな言い間違いや言い淀みは適切に修正してください
4. 不完全な文や中断された文は可能な限り完成させてください
5. [不明]とマークされた部分は、文脈から推測できる場合は適切な内容で補完してください
6. 重複した内容や冗長な表現を整理してください
7. 段落分けを適切に行い、読みやすさを向上させてください

## 最重要指示
- 元の文字起こしの内容や意味を変えないでください
- 架空のセミナー内容を生成しないでください
- 「AIスクールセミナー」などの架空の設定を追加しないでください
- 実際の音声内容のみを整形してください
- 話者の発言内容を忠実に保ちながら、読みやすさと正確さを向上させることが目的です

${text}

元の文字起こしの内容や意味を変えないように注意してください。整形・改善された文字起こしを出力してください。`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const enhancedText = response.text();
      
      return enhancedText;
    } catch (error: any) {
      console.error('文字起こし整形・改善エラー:', error);
      // エラーが発生した場合は元のテキストをそのまま返す
      return text;
    }
  }

  /**
   * 要約処理
   * @param text 要約するテキスト
   * @returns 要約結果
   */
  async summarizeText(text: string): Promise<string> {
    try {
      console.log('要約処理を開始');
      
      // テキストが空の場合はエラー
      if (!text || text.trim() === '') {
        throw new Error('要約するテキストが空です');
      }
      
      // モデルの取得
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
      // プロンプトの作成
      const prompt = `
あなたは高度な要約AIです。以下の文字起こしテキストを要約してください。

## 指示
- 重要なポイントを抽出し、簡潔にまとめてください
- 元の内容の意味を保持しながら、冗長な部分を削除してください
- 箇条書きではなく、段落形式で要約してください
- 要約は元のテキストの約20%の長さにしてください
- 架空の内容を追加しないでください

## 文字起こしテキスト:
${text}
`;
      
      // 要約の生成
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text();
      
      console.log('要約処理が完了しました');
      return summary;
    } catch (error) {
      console.error('要約処理エラー:', error);
      throw new Error('要約処理中にエラーが発生しました: ' + (error instanceof Error ? error.message : '不明なエラー'));
    }
  }

  /**
   * タイムスタンプ抽出処理
   * @param prompt タイムスタンプ抽出用のプロンプト
   * @param recordId レコードID（データベースに保存する場合）
   * @returns タイムスタンプ抽出結果（JSON文字列）
   */
  async extractTimestamps(prompt: string, recordId?: string): Promise<string> {
    try {
      console.log('タイムスタンプ抽出処理を開始');
      
      // プロンプトが空の場合はエラー
      if (!prompt || prompt.trim() === '') {
        throw new Error('タイムスタンプ抽出用のプロンプトが空です');
      }
      
      // モデルの取得
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
      // タイムスタンプの抽出
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const timestampsResponse = response.text();
      
      console.log('タイムスタンプ抽出処理が完了しました');
      
      // JSONを抽出
      let jsonContent = '';
      const jsonMatch = timestampsResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        // JSONブロックが見つかった場合
        jsonContent = jsonMatch[1];
      } else {
        // JSONブロックがない場合は、テキスト全体をJSONとして解析を試みる
        jsonContent = timestampsResponse.trim();
      }
      
      try {
        const timestampsData = JSON.parse(jsonContent);
        console.log(`抽出されたタイムスタンプ: ${timestampsData.timestamps.length}個`);
        
        // レコードIDが指定されている場合はデータベースに保存
        if (recordId) {
          console.log(`レコードID ${recordId} のタイムスタンプをデータベースに保存します`);
          
          try {
            // APIエンドポイントを呼び出してデータベースに保存
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://video-processing-api.onrender.com';
            const response = await fetch(`${apiUrl}/api/records/${recordId}/timestamps`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                timestamps_json: JSON.stringify(timestampsData)
              }),
            });
            
            if (!response.ok) {
              const errorText = await response.text();
              console.error('タイムスタンプの保存に失敗しました:', errorText);
              throw new Error(`タイムスタンプの保存に失敗しました: ${errorText}`);
            }
            
            console.log('タイムスタンプをデータベースに保存しました');
          } catch (saveError) {
            console.error('タイムスタンプの保存中にエラーが発生しました:', saveError);
            // 保存エラーは無視して処理を続行
          }
        }
        
        return JSON.stringify(timestampsData);
      } catch (parseError) {
        console.error('タイムスタンプJSONの解析に失敗しました:', parseError);
        console.log('生のレスポンス:', timestampsResponse);
        throw new Error('タイムスタンプの解析に失敗しました');
      }
    } catch (error) {
      console.error('タイムスタンプ抽出処理エラー:', error);
      throw new Error('タイムスタンプ抽出処理中にエラーが発生しました: ' + (error instanceof Error ? error.message : '不明なエラー'));
    }
  }

  /**
   * 文字起こし用のプロンプトを作成する
   * @returns プロンプト文字列
   */
  private createTranscriptionPrompt(): string {
    let promptText = `あなたは高性能な文字起こしAIです。提供された音声ファイルを聞いて、正確に文字起こしを行ってください。`;
    
    promptText += `\n\n## 文字起こしの指示
1. 全ての言葉を省略せず、一言一句正確に文字起こししてください
2. 専門用語や固有名詞のスペルや表記を統一し、正確にしてください
3. 話者の区別を明確にし、一貫性のある形式で表示してください（例：「講師：」「参加者A：」など）
4. 聞き取れない部分は[不明]と記録してください
5. 音声の特徴（笑い、ため息、強調など）も[笑い]のように記録してください
6. 言い間違いや言い直しも忠実に書き起こしてください
7. 日本語の場合は、敬語や話し言葉のニュアンスを保持してください`;
    
    return promptText;
  }

  /**
   * Uint8ArrayをBase64に変換
   */
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
