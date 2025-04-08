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

// Redisの接続URL
const redisUrl = process.env.REDIS_URL;

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// 文字起こしサービスの初期化
const transcriptionService = new TranscriptionService();

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
  {
    connection: redisUrl ? {
      url: redisUrl
    } : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    },
    concurrency: 10,
    limiter: {
      max: 40,
      duration: 60000
    }
  }
);

// ワーカーイベントリスナー
worker.on('completed', (job: Job) => {
  console.log(`ジョブ完了: ${job.id}`);
});

worker.on('failed', (job: Job | undefined, error: Error) => {
  console.error(`ジョブ失敗: ${job?.id}`, error);
});

worker.on('error', (error: Error) => {
  console.error('ワーカーエラー:', error);
});

console.log(`文字起こしワーカーを起動しました (PID: ${process.pid})`);

// プロセス終了時の処理
process.on('SIGTERM', async () => {
  console.log('SIGTERM受信、ワーカーを終了します');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT受信、ワーカーを終了します');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});
