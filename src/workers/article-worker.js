/**
 * 記事生成ワーカー
 * BullMQを使用して非同期で記事生成処理を実行します
 */
const { Worker, Job } = require('bullmq');
const { PrismaClient } = require('@prisma/client');
const { queueManager, QUEUE_NAMES } = require('../lib/bull-queue');
const dotenv = require('dotenv');
const { generateArticle } = require('../services/article-service');

// 環境変数の読み込み
dotenv.config();

// Redisの接続URL
const redisUrl = process.env.REDIS_URL;

// Prismaクライアントの初期化
const prisma = new PrismaClient();

/**
 * 記事生成ジョブの処理関数
 * @param job 記事生成ジョブ
 */
async function processArticleJob(job) {
  try {
    const { recordId } = job.data;
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 5, '処理開始', '記事生成処理を開始しています');
    
    // レコードの存在確認
    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });
    
    if (!record) {
      throw new Error(`レコードが見つかりません: ${recordId}`);
    }
    
    if (!record.transcript_text || !record.summary_text) {
      throw new Error(`文字起こしまたは要約テキストがありません: ${recordId}`);
    }
    
    // ステータスを更新
    await prisma.record.update({
      where: { id: recordId },
      data: { status: 'GENERATING_ARTICLE' }
    });
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 30, '処理中', '記事を生成しています');
    
    // 記事を生成
    const article = await generateArticle(record.transcript_text, record.summary_text);
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 90, '処理中', '結果を保存しています');
    
    // 結果をデータベースに保存
    await prisma.record.update({
      where: { id: recordId },
      data: {
        article_text: article,
        status: 'COMPLETED'
      }
    });
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 100, 'completed', '記事生成が完了しました');
    
    return {
      success: true,
      recordId,
      message: '記事生成が完了しました'
    };
  } catch (error) {
    console.error('記事生成処理エラー:', error);
    
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

// ワーカーの初期化
const worker = new Worker(
  QUEUE_NAMES.ARTICLE,
  processArticleJob,
  {
    connection: redisUrl ? {
      url: redisUrl
    } : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    },
    concurrency: 1, // 同時実行数
    limiter: {
      max: 2, // 最大2ジョブ
      duration: 1000 * 60 // 1分間
    }
  }
);

// ワーカーイベントリスナー
worker.on('completed', (job) => {
  console.log(`ジョブ完了: ${job.id}`);
});

worker.on('failed', (job, error) => {
  console.error(`ジョブ失敗: ${job?.id}`, error);
});

worker.on('error', (error) => {
  console.error('ワーカーエラー:', error);
});

console.log(`記事生成ワーカーを起動しました (PID: ${process.pid})`);

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
