/**
 * 文字起こしワーカー
 * BullMQを使用して非同期で文字起こし処理を実行します
 */
import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { TranscriptionService } from '../services/transcription-service';
import { getDownloadUrl } from '../lib/storage';
import { queueManager, QUEUE_NAMES } from '../lib/bull-queue';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new PrismaClient({
  log: ['error', 'warn'],
  errorFormat: 'minimal'
});

// 文字起こしサービスの初期化
const transcriptionService = new TranscriptionService();

// Redis接続オプション
const redisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

// ワーカーオプション
const workerOptions = {
  connection: redisOptions,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'),
  limiter: {
    max: parseInt(process.env.WORKER_RATE_LIMIT_MAX || '5'),
    duration: parseInt(process.env.WORKER_RATE_LIMIT_DURATION || '60000')
  },
  stalledInterval: 30000,
  lockDuration: 600000,
  lockRenewTime: 300000
};

/**
 * 文字起こしジョブの処理関数
 * @param job 文字起こしジョブ
 */
async function processTranscriptionJob(job: Job): Promise<any> {
  try {
    const { fileKey, recordId } = job.data;
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 5, '処理開始', '文字起こし処理を開始しています');
    
    // レコードの存在確認
    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });
    
    if (!record) {
      throw new Error(`レコードが見つかりません: ${recordId}`);
    }
    
    // ステータスを更新
    await prisma.record.update({
      where: { id: recordId },
      data: { status: 'PROCESSING' }
    });
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 10, '処理中', 'ファイルをダウンロードしています');
    
    // ファイルのダウンロードURLを取得
    const downloadUrl = await getDownloadUrl(fileKey);
    
    // 一時ディレクトリを作成
    const tempDir = path.join(os.tmpdir(), `transcription-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 20, '処理中', 'ファイルを処理しています');
    
    // メモリ使用量を監視
    const memUsage = process.memoryUsage();
    console.log(`メモリ使用量: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
    
    // 文字起こし処理
    await queueManager.updateJobProgress(job, 30, '処理中', '文字起こしを実行しています');
    
    // ファイルをダウンロードして文字起こし
    const transcription = await transcriptionService.transcribeAudio(downloadUrl);
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 90, '処理中', '結果を保存しています');
    
    // 結果をデータベースに保存
    await prisma.record.update({
      where: { id: recordId },
      data: {
        transcript_text: transcription,
        status: 'TRANSCRIBED'
      }
    });
    
    // 一時ディレクトリを削除
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('一時ディレクトリの削除に失敗しました:', error);
    }
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 100, 'completed', '文字起こしが完了しました');
    
    // 要約ジョブをキューに追加
    const summaryJobId = await queueManager.addJob(QUEUE_NAMES.SUMMARY, {
      type: 'summary',
      recordId,
      fileKey
    });
    
    console.log(`要約ジョブをキューに追加しました: ${summaryJobId}`);
    
    return {
      success: true,
      recordId,
      message: '文字起こしが完了しました',
      nextJob: {
        type: 'summary',
        jobId: summaryJobId
      }
    };
  } catch (error) {
    console.error('文字起こし処理エラー:', error);
    
    // エラー情報を記録
    try {
      await prisma.record.update({
        where: { id: job.data.recordId },
        data: {
          status: 'ERROR',
          error: error instanceof Error ? error.message : '不明なエラー'
        }
      });
    } catch (dbError) {
      console.error('エラー情報の記録に失敗しました:', dbError);
    }
    
    throw error;
  }
}

/**
 * メモリ使用量を監視する関数
 */
function monitorMemoryUsage(): void {
  const memUsage = process.memoryUsage();
  const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  console.log(`メモリ使用量: ${memUsageMB}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
  
  // メモリ使用量が閾値を超えた場合、GCを促進
  if (memUsageMB > 1024) { // 1GB以上
    if (global.gc) {
      console.log('ガベージコレクションを実行します');
      global.gc();
    } else {
      console.log('ガベージコレクションを実行できません。--expose-gc フラグを使用してください。');
    }
  }
}

// 定期的にメモリ使用量を監視
setInterval(monitorMemoryUsage, 60000); // 1分ごと

// ワーカーの初期化
const worker = new Worker(
  QUEUE_NAMES.TRANSCRIPTION,
  processTranscriptionJob,
  workerOptions
);

// ワーカーイベントリスナー
worker.on('completed', (job: Job) => {
  console.log(`ジョブ完了: ${job.id}`);
});

worker.on('failed', (job: Job | undefined, error: Error) => {
  console.error(`ジョブ失敗: ${job?.id}`, error);
  console.error('エラーの詳細:', error.stack);
});

worker.on('error', (error: Error) => {
  console.error('ワーカーエラー:', error);
  console.error('エラーの詳細:', error.stack);
});

worker.on('stalled', (jobId: string) => {
  console.warn(`ジョブがストール状態になりました: ${jobId}`);
});

console.log(`文字起こしワーカーを起動しました (PID: ${process.pid})`);
console.log('ワーカー設定:', {
  concurrency: workerOptions.concurrency,
  limiter: workerOptions.limiter,
  redis: {
    host: redisOptions.host,
    port: redisOptions.port
  }
});

// プロセス終了時の処理
async function gracefulShutdown(signal: string) {
  console.log(`${signal}受信、ワーカーを終了します`);
  try {
    await worker.close();
    await prisma.$disconnect();
    console.log('正常に終了しました');
    process.exit(0);
  } catch (error) {
    console.error('終了処理中にエラーが発生しました:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 未処理のエラーをキャッチ
process.on('unhandledRejection', (reason, promise) => {
  console.error('未処理のPromise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('未処理の例外:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION').catch(console.error);
});
