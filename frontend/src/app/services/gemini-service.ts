import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as util from 'util';
import * as stream from 'stream';
import * as crypto from 'crypto';
import axios from 'axios';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { exec } from 'child_process';

// ffmpegのインポート
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Gemini AIサービスクラス
 */
export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: string;
  private s3Client: any;
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
    try {
      console.log(`文字起こし処理を開始: ${fileUrl}`);
      
      // ファイルURLからバケット名とキーを抽出
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
          const tempDir = path.join(os.tmpdir(), 'video-processing-' + crypto.randomBytes(6).toString('hex'));
          fs.mkdirSync(tempDir, { recursive: true });
          
          // ファイルをダウンロード
          const localFilePath = path.join(tempDir, path.basename(key));
          console.log(`公開URLからファイルをダウンロード中: ${localFilePath}`);
          
          const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream'
          });
          
          await this.pipeline(
            response.data,
            fs.createWriteStream(localFilePath)
          );
          
          console.log(`公開URLからのダウンロード完了: ${localFilePath}`);
          
          // ファイルサイズを確認
          const stats = fs.statSync(localFilePath);
          const fileSizeInMB = stats.size / (1024 * 1024);
          console.log(`ファイルサイズ: ${fileSizeInMB.toFixed(2)} MB`);
          
          // 大きなファイルの場合は分割処理
          let transcriptParts: string[] = [];
          
          if (fileSizeInMB > 20) {
            console.log('ファイルサイズが大きいため、分割処理を実行します');
            transcriptParts = await this.processLargeFile(localFilePath);
          } else {
            // 小さなファイルの場合は直接処理
            const audioBase64 = fs.readFileSync(localFilePath).toString('base64');
            const transcript = await this.processAudioChunk(audioBase64);
            transcriptParts.push(transcript);
          }
          
          // 一時ファイルを削除
          fs.unlinkSync(localFilePath);
          fs.rmdirSync(tempDir, { recursive: true });
          
          // 全ての文字起こし結果を結合
          const fullTranscript = transcriptParts.join('\n\n');
          console.log('文字起こし完了');
          
          return fullTranscript;
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
      const tempDir = path.join(os.tmpdir(), 'video-processing-' + crypto.randomBytes(6).toString('hex'));
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
      
      // ファイルをダウンロード
      const response = await axios({
        method: 'get',
        url: signedUrl,
        responseType: 'stream'
      });
      
      await this.pipeline(
        response.data,
        fs.createWriteStream(localFilePath)
      );
      
      console.log(`ファイルのダウンロード完了: ${localFilePath}`);
      
      // ファイルサイズを確認
      const stats = fs.statSync(localFilePath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      console.log(`ファイルサイズ: ${fileSizeInMB.toFixed(2)} MB`);
      
      // 大きなファイルの場合は分割処理
      let transcriptParts: string[] = [];
      
      if (fileSizeInMB > 20) {
        console.log('ファイルサイズが大きいため、分割処理を実行します');
        transcriptParts = await this.processLargeFile(localFilePath);
      } else {
        // 小さなファイルの場合は直接処理
        const audioBase64 = fs.readFileSync(localFilePath).toString('base64');
        const transcript = await this.processAudioChunk(audioBase64);
        transcriptParts.push(transcript);
      }
      
      // 一時ファイルを削除
      fs.unlinkSync(localFilePath);
      fs.rmdirSync(tempDir, { recursive: true });
      
      // 全ての文字起こし結果を結合
      const fullTranscript = transcriptParts.join('\n\n');
      console.log('文字起こし完了');
      
      return fullTranscript;
    } catch (error: any) {
      console.error('文字起こしエラー:', error);
      throw new Error(`文字起こし処理に失敗しました: ${error.message}`);
    }
  }
  
  // 大きなファイルを分割して処理
  private async processLargeFile(filePath: string): Promise<string[]> {
    const tempDir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const segmentDuration = 5 * 60; // 5分ごとに分割
    const outputPattern = path.join(tempDir, `${baseName}_segment_%03d.mp3`);
    
    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .outputOptions([
          `-f segment`,
          `-segment_time ${segmentDuration}`,
          `-c:a libmp3lame`,
          `-q:a 4`
        ])
        .output(outputPattern)
        .on('end', async () => {
          try {
            // 分割されたファイルを取得
            const segmentFiles = fs.readdirSync(tempDir)
              .filter(file => file.startsWith(`${baseName}_segment_`))
              .sort();
            
            console.log(`ファイルを${segmentFiles.length}個のセグメントに分割しました`);
            
            // 各セグメントを処理
            const transcriptParts: string[] = [];
            
            for (let i = 0; i < segmentFiles.length; i++) {
              const segmentPath = path.join(tempDir, segmentFiles[i]);
              console.log(`セグメント ${i+1}/${segmentFiles.length} を処理中: ${segmentPath}`);
              
              const audioBase64 = fs.readFileSync(segmentPath).toString('base64');
              const transcript = await this.processAudioChunk(audioBase64, i+1, segmentFiles.length);
              transcriptParts.push(transcript);
              
              // 処理後にセグメントファイルを削除
              fs.unlinkSync(segmentPath);
            }
            
            resolve(transcriptParts);
          } catch (error: any) {
            reject(error);
          }
        })
        .on('error', (err: any) => {
          reject(new Error(`ファイル分割エラー: ${err.message}`));
        })
        .run();
    });
  }
  
  // 音声チャンクを処理
  private async processAudioChunk(base64Audio: string, segmentIndex?: number, totalSegments?: number): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: this.model });
    
    let promptText = `あなたは高精度文字起こしの専門家です。このファイルはAIスクールのセミナーの録音データです。`;
    
    if (segmentIndex && totalSegments) {
      promptText += `\n\nこれは${totalSegments}個に分割された音声の${segmentIndex}番目のセグメントです。`;
    }
    
    promptText += `\n\n## 文字起こしの指示
1. 全ての言葉を省略せず、一言一句正確に文字起こししてください
2. 専門用語や固有名詞は特に注意して正確に書き起こしてください
3. 話者を識別し、適切にラベル付けしてください（「講師：」「参加者A：」など）
4. 聞き取れない部分は[不明]と記録してください
5. 音声の特徴（笑い、ため息、強調など）も[笑い]のように記録してください
6. 言い間違いや言い直しも忠実に書き起こしてください

## 専門用語・固有名詞リスト
以下のAI・機械学習用語や固有名詞が頻出します:
- LLM: 大規模言語モデル（Large Language Model）
- ファインチューニング: モデルの微調整
- プロンプトエンジニアリング: AIへの指示の最適化
- トークン: AIモデルが処理する言語の最小単位
- Gemini: Googleの大規模言語モデル
- Claude: Anthropicの大規模言語モデル
- GPT: OpenAIの大規模言語モデル
- RAG: Retrieval-Augmented Generation（検索拡張生成）

## 音声特性
- セミナー形式：講師による講義と質疑応答
- 背景音：時折キーボードのタイピング音や紙をめくる音があります
- 音質：一部音声が小さい箇所や重なる箇所があります

このセミナーはAI技術教育のための重要な資料となるため、特に専門用語、技術的な説明、アルゴリズムの解説などを正確に文字起こししてください。全ての言葉を省略せず、一言一句漏らさず文字起こしして下さい。`;
    
    try {
      // Gemini APIに送信
      const result = await model.generateContent([
        { text: promptText },
        {
          inlineData: {
            mimeType: 'audio/mp3', // または適切なMIMEタイプ
            data: base64Audio
          }
        }
      ]);
      
      const response = await result.response;
      const text = response.text();
      return text;
    } catch (error: any) {
      console.error('音声チャンク処理エラー:', error);
      throw new Error(`音声チャンク処理に失敗しました: ${error.message}`);
    }
  }

  // 文字起こし結果の整形・改善処理
  async enhanceTranscript(text: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
      const prompt = `あなたはAI・機械学習分野の専門家で、文字起こしデータの整形と改善を行う専門家です。以下のAIスクールセミナーの文字起こしテキストを整形・改善してください。

## 整形・改善の指示
1. 話者の区別を明確にし、一貫性のある形式で表示してください（例：「講師：」「参加者A：」など）
2. 専門用語や固有名詞のスペルや表記を統一し、正確にしてください
3. 文脈から明らかな言い間違いや言い淀みは適切に修正してください
4. 不完全な文や中断された文は可能な限り完成させてください
5. [不明]とマークされた部分は、文脈から推測できる場合は適切な内容で補完してください
6. 重複した内容や冗長な表現を整理してください
7. 段落分けを適切に行い、読みやすさを向上させてください

## 専門用語・固有名詞リスト
以下のAI・機械学習用語や固有名詞の表記を統一してください:
- LLM / 大規模言語モデル / Large Language Model → LLM（大規模言語モデル）
- ファインチューニング / fine-tuning / 微調整 → ファインチューニング
- プロンプトエンジニアリング / prompt engineering → プロンプトエンジニアリング
- トークン / token → トークン
- Gemini / ジェミナイ → Gemini
- Claude / クロード → Claude
- GPT / ジーピーティー → GPT
- RAG / 検索拡張生成 / Retrieval-Augmented Generation → RAG（検索拡張生成）

${text}

元の文字起こしの内容や意味を変えないように注意してください。話者の発言内容を忠実に保ちながら、読みやすさと正確さを向上させることが目的です。整形・改善された文字起こしを出力してください。`;
      
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

  // 要約処理
  async summarizeText(text: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
      const prompt = `あなたはAI・機械学習分野の専門家で、高度な要約スキルを持っています。以下のAIスクールセミナーの文字起こしテキストを要約してください。

## 要約の指示
1. セミナーの主要なトピックと重要なポイントを明確に抽出してください
2. 専門用語や技術的な概念を正確に保持してください
3. 講師の説明、例示、デモンストレーションの要点を含めてください
4. 質疑応答から得られた重要な洞察を含めてください
5. 論理的な構造を維持し、トピック間の関連性を示してください
6. 技術的な正確さを保ちながら、簡潔で理解しやすい表現を使用してください

## 専門用語の保持
以下の専門用語や概念が出てきた場合は、要約に必ず含めてください：
- LLM（大規模言語モデル）の仕組みと応用
- ファインチューニングの手法と効果
- プロンプトエンジニアリングの技術
- RAG（検索拡張生成）の実装方法
- AIモデルの評価指標と改善方法
- 最新のAIモデル（Gemini、Claude、GPTなど）の特徴と違い

${text}

要約は日本語で、元のテキストの重要なポイントを含め、約500語の長さにしてください。この要約はAI技術を学ぶ学生や専門家のための教材として使用されるため、技術的な正確さと教育的価値を重視してください。`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text();
      
      return summary;
    } catch (error: any) {
      console.error('要約エラー:', error);
      throw new Error('要約処理に失敗しました');
    }
  }
}
