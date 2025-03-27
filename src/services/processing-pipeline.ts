import { GeminiService } from './gemini-service';
import { ClaudeService } from './claude-service';
import { FFmpegService } from './ffmpeg-service';
import { TranscriptionService } from './transcription-service';
import { PrismaClient, Status } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import axios from 'axios';
import { pipeline } from 'stream/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const prisma = new PrismaClient();

// 処理ステップの定義
type ProcessingStep = 'TRANSCRIPTION' | 'SUMMARY' | 'ARTICLE' | null;

// AI処理パイプラインを管理するクラス
export class ProcessingPipeline {
  private geminiService: GeminiService;
  private claudeService: ClaudeService;
  private ffmpegService: FFmpegService;
  private transcriptionService: TranscriptionService;
  private s3Client: S3Client;

  constructor() {
    this.geminiService = new GeminiService();
    this.claudeService = new ClaudeService();
    this.ffmpegService = new FFmpegService();
    this.transcriptionService = new TranscriptionService();
    
    // S3クライアントの初期化
    this.s3Client = new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    });
  }

  // 処理パイプラインを実行
  async process(recordId: string): Promise<void> {
    let localFilePath = '';
    let tempDir = '';
    
    try {
      console.log(`[${recordId}] 処理パイプラインを開始します...`);
      
      // レコードの取得
      const record = await prisma.record.findUnique({
        where: { id: recordId }
      });
      
      if (!record) {
        throw new Error(`レコードが見つかりません: ${recordId}`);
      }
      
      // ステータスを処理中に更新
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          status: Status.PROCESSING,
          processing_step: 'TRANSCRIPTION' as ProcessingStep
        }
      });
      
      // ファイルURLを取得
      let fileUrl = '';
      if (record.file_key && (record.file_key.startsWith('http://') || record.file_key.startsWith('https://'))) {
        fileUrl = record.file_key;
      } else {
        const r2BucketName = record.r2_bucket || process.env.R2_BUCKET_NAME || 'video-processing';
        fileUrl = record.file_key || '';
      }
      
      if (!fileUrl) {
        throw new Error(`ファイルURLまたはキーが見つかりません: ${recordId}`);
      }
      
      console.log(`[${recordId}] ファイルURL: ${fileUrl}`);
      
      // ファイルをダウンロード
      tempDir = path.join(os.tmpdir(), 'processing-' + crypto.randomBytes(6).toString('hex'));
      fs.mkdirSync(tempDir, { recursive: true });
      
      // R2バケット名
      const r2BucketName = record.r2_bucket || process.env.R2_BUCKET_NAME || 'video-processing';
      
      // ファイルのダウンロード処理
      if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        if (!fileUrl.includes('r2.cloudflarestorage.com') && !fileUrl.includes('cloudflare')) {
          // 公開URLからダウンロード
          console.log(`[${recordId}] 公開URLからファイルをダウンロードします`);
          localFilePath = path.join(tempDir, 'video' + path.extname(fileUrl) || '.mp4');
          
          const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream'
          });
          
          await pipeline(
            response.data,
            fs.createWriteStream(localFilePath)
          );
        } else {
          // R2の署名付きURLからダウンロード
          console.log(`[${recordId}] R2の署名付きURLからファイルをダウンロードします`);
          
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
          
          localFilePath = path.join(tempDir, path.basename(key));
          
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
        }
      } else {
        // ローカルパスまたはR2キーの場合
        console.log(`[${recordId}] R2からファイルをダウンロードします`);
        
        const key = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
        localFilePath = path.join(tempDir, path.basename(key));
        
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
      }
      
      console.log(`[${recordId}] ファイルのダウンロード完了: ${localFilePath}`);
      
      // 動画から音声を抽出
      console.log(`[${recordId}] 動画から音声を抽出します...`);
      const audioPath = await this.ffmpegService.extractAudio(localFilePath, 'mp3');
      console.log(`[${recordId}] 音声抽出完了: ${audioPath}`);
      
      // 文字起こし処理
      console.log(`[${recordId}] 文字起こし処理を開始します...`);
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          processing_step: 'TRANSCRIPTION' as ProcessingStep
        }
      });
      
      // 高精度文字起こしサービスを使用
      const transcriptionText = await this.transcriptionService.transcribeAudio(audioPath);
      
      // 文字起こし結果を保存
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          transcript_text: transcriptionText
        }
      });
      
      console.log(`[${recordId}] 文字起こし処理が完了しました`);
      
      // 要約処理
      console.log(`[${recordId}] 要約処理を開始します...`);
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          processing_step: 'SUMMARY' as ProcessingStep
        }
      });
      
      const summaryText = await this.geminiService.generateSummary(transcriptionText);
      
      // 要約結果を保存
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          summary_text: summaryText
        }
      });
      
      console.log(`[${recordId}] 要約処理が完了しました`);
      
      // 記事生成処理
      console.log(`[${recordId}] 記事生成処理を開始します...`);
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          processing_step: 'ARTICLE' as ProcessingStep
        }
      });
      
      const articleText = await this.claudeService.generateArticle(summaryText);
      
      // 記事生成結果を保存
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          article_text: articleText,
          status: Status.DONE
        }
      });
      
      console.log(`[${recordId}] 記事生成処理が完了しました`);
      console.log(`[${recordId}] すべての処理が完了しました`);
      
    } catch (error) {
      console.error(`[${recordId}] 処理中にエラーが発生しました:`, error);
      
      // エラー情報を保存
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          status: Status.ERROR,
          error: error instanceof Error ? error.message : String(error)
        }
      });
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
        console.error(`一時ファイルの削除に失敗しました:`, cleanupError);
      }
    }
  }
}
