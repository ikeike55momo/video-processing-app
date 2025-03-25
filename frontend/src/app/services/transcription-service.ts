import { GoogleGenerativeAI } from '@google/generative-ai';
import { SpeechClient } from '@google-cloud/speech';
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
 * Gemini FlashとCloud Speech-to-Textを組み合わせて高精度な文字起こしを実現
 */
export class TranscriptionService {
  private genAI: GoogleGenerativeAI;
  private speechClient: SpeechClient;
  private geminiModel: string;
  private geminiMergeModel: string;
  private s3Client: S3Client;

  constructor() {
    // APIキーの取得
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY環境変数が設定されていません');
    }

    // Gemini APIの初期化
    this.genAI = new GoogleGenerativeAI(geminiApiKey);
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    this.geminiMergeModel = 'gemini-2.0-pro';

    // Speech-to-Text APIの初期化
    this.speechClient = new SpeechClient();

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
   * ファイルURLから文字起こしを行う
   * @param fileUrl ファイルのURL
   * @returns 文字起こし結果
   */
  async transcribeAudio(fileUrl: string): Promise<string> {
    try {
      console.log(`ファイルURLから文字起こしを開始: ${fileUrl}`);
      
      // R2バケット名
      const r2BucketName = process.env.R2_BUCKET_NAME || 'video-processing';
      
      let bucketName = '';
      let key = '';
      
      // URLの形式に応じた処理
      if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        if (!fileUrl.includes('r2.cloudflarestorage.com') && !fileUrl.includes('cloudflare')) {
          // 公開URLの場合、一時ファイルにダウンロード
          console.log('公開URLからファイルをダウンロードします');
          
          // 一時ディレクトリを作成
          const tempDir = path.join(os.tmpdir(), 'transcription-' + crypto.randomBytes(6).toString('hex'));
          fs.mkdirSync(tempDir, { recursive: true });
          
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
          
          // ファイルから文字起こし
          const transcript = await this.processLocalFile(localFilePath);
          
          // 一時ファイルを削除
          fs.unlinkSync(localFilePath);
          fs.rmdirSync(tempDir, { recursive: true });
          
          return transcript;
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
      const tempDir = path.join(os.tmpdir(), 'transcription-' + crypto.randomBytes(6).toString('hex'));
      fs.mkdirSync(tempDir, { recursive: true });
      
      // ファイルをダウンロード
      const localFilePath = path.join(tempDir, path.basename(key));
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
        responseType: 'stream'
      });
      
      await pipeline(
        response.data,
        fs.createWriteStream(localFilePath)
      );
      
      console.log(`ファイルのダウンロード完了: ${localFilePath}`);
      
      // ローカルファイルから文字起こし
      const transcript = await this.processLocalFile(localFilePath);
      
      // 一時ファイルを削除
      fs.unlinkSync(localFilePath);
      fs.rmdirSync(tempDir, { recursive: true });
      
      return transcript;
    } catch (error: any) {
      console.error('文字起こしエラー:', error);
      throw new Error(`文字起こし処理に失敗しました: ${error.message}`);
    }
  }

  /**
   * ローカルファイルから文字起こしを行う
   * @param filePath ローカルファイルのパス
   * @returns 文字起こし結果
   */
  private async processLocalFile(filePath: string): Promise<string> {
    try {
      console.log(`ローカルファイルの文字起こしを開始: ${filePath}`);

      // ファイルサイズを確認
      const stats = fs.statSync(filePath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      console.log(`ファイルサイズ: ${fileSizeInMB.toFixed(2)} MB`);
      
      // ファイル拡張子を確認
      const fileExt = path.extname(filePath).toLowerCase();
      console.log(`ファイル拡張子: ${fileExt}`);
      
      // ファイルの種類に応じた処理
      let audioData: Buffer;
      let mimeType: string;
      
      if (['.mp3', '.wav', '.ogg'].includes(fileExt)) {
        // 音声ファイルの場合はそのまま処理
        console.log('音声ファイルを直接処理します');
        audioData = fs.readFileSync(filePath);
        
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
        const fileSize = stats.size;
        const readSize = Math.min(AUDIO_CHUNK_SIZE, fileSize);
        
        // ファイルの先頭部分を読み込む
        audioData = Buffer.alloc(readSize);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, audioData, 0, readSize, 0);
        fs.closeSync(fd);
        
        // 音声ファイルとして扱うためのMIMEタイプを設定
        mimeType = 'audio/mpeg'; // mp3として扱う
      }
      
      // Base64エンコード
      const audioBase64 = audioData.toString('base64');
      console.log(`音声データをBase64エンコードしました (${audioBase64.length} 文字)`);
      
      // 1. Gemini Flashで文字起こし
      console.log('Gemini Flashで文字起こしを実行中...');
      const geminiTranscript = await this.transcribeWithGemini(audioBase64, mimeType);

      // 2. Cloud Speech-to-Textで文字起こし
      console.log('Cloud Speech-to-Textで文字起こしを実行中...');
      const speechToTextTranscript = await this.transcribeWithSpeechToText(audioData);

      // 3. Gemini Proで結果をマージ
      console.log('Gemini Proで文字起こし結果をマージ中...');
      const mergedTranscript = await this.mergeTranscripts(geminiTranscript, speechToTextTranscript);

      console.log('文字起こし完了');
      return mergedTranscript;
    } catch (error: any) {
      console.error('ローカルファイル処理エラー:', error);
      throw new Error(`ローカルファイル処理に失敗しました: ${error.message}`);
    }
  }

  /**
   * Gemini Flashを使用して文字起こしを行う
   * @param audioBase64 Base64エンコードされた音声データ
   * @param mimeType 音声データのMIMEタイプ
   * @returns 文字起こし結果
   */
  private async transcribeWithGemini(audioBase64: string, mimeType: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
      
      // プロンプトを作成
      const promptText = `あなたは高性能な文字起こしAIです。提供された音声ファイルを聞いて、正確に文字起こしを行ってください。
      
以下の点に注意して文字起こしを行ってください：
1. 話者の言葉を正確に書き起こす
2. 専門用語や固有名詞も正確に認識する
3. 句読点を適切に配置する
4. 日本語の場合は漢字とかな遣いに注意する
5. 文脈に基づいて適切な漢字を選択する

文字起こし結果は整形せずにプレーンテキストで出力してください。`;
      
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
      console.error('Gemini文字起こしエラー:', error);
      throw new Error(`Geminiでの文字起こしに失敗しました: ${error.message}`);
    }
  }

  /**
   * Cloud Speech-to-Textを使用して文字起こしを行う
   * @param audioContent 音声データのバッファ
   * @returns 文字起こし結果
   */
  private async transcribeWithSpeechToText(audioContent: Buffer): Promise<string> {
    try {
      // リクエスト設定
      const request = {
        audio: {
          content: audioContent.toString('base64'),
        },
        config: {
          encoding: 'MP3' as const,
          sampleRateHertz: 16000,
          languageCode: 'ja-JP',
          enableAutomaticPunctuation: true,
          model: 'latest_long',
          useEnhanced: true,
        },
      };

      // 音声認識リクエスト
      const [response] = await this.speechClient.recognize(request);
      const transcription = response.results
        ?.map(result => result.alternatives?.[0]?.transcript)
        .filter(Boolean)
        .join('\n');

      return transcription || '';
    } catch (error: any) {
      console.error('Speech-to-Text文字起こしエラー:', error);
      throw new Error(`Speech-to-Textでの文字起こしに失敗しました: ${error.message}`);
    }
  }

  /**
   * Gemini ProでGemini FlashとSpeech-to-Textの結果をマージする
   * @param geminiTranscript Gemini Flashの文字起こし結果
   * @param speechToTextTranscript Speech-to-Textの文字起こし結果
   * @returns マージされた文字起こし結果
   */
  private async mergeTranscripts(geminiTranscript: string, speechToTextTranscript: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.geminiMergeModel });
      
      // プロンプトを作成
      const promptText = `あなたは高性能な文字起こし結果マージAIです。2つの異なるAIによる文字起こし結果を比較して、最も正確な文字起こし結果を生成してください。

# 文字起こし結果1（Gemini Flash）:
${geminiTranscript}

# 文字起こし結果2（Cloud Speech-to-Text）:
${speechToTextTranscript}

以下の点に注意して最適な文字起こし結果を生成してください：
1. 両方の結果を比較し、より正確と思われる部分を採用する
2. 専門用語や固有名詞は文脈から判断して最適な表記を選択する
3. 日本語の場合は適切な漢字を使用する
4. 句読点を適切に配置する
5. 話者の意図を正確に反映する

最終的な文字起こし結果のみを出力してください。解説は不要です。`;
      
      // マージリクエストを作成
      const result = await model.generateContent(promptText);
      const response = await result.response;
      const mergedText = response.text();
      
      return mergedText;
    } catch (error: any) {
      console.error('文字起こしマージエラー:', error);
      // マージに失敗した場合はGemini Flashの結果を返す
      console.log('マージに失敗したため、Gemini Flashの結果を使用します');
      return geminiTranscript;
    }
  }
}
