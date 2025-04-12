import * as dotenv from 'dotenv';
import { PrismaClient, Status } from '@prisma/client';
import { Job, Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { queueManager, QUEUE_NAMES, JobData } from '../lib/bull-queue';
import axios from 'axios'; // Import axios

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// キュー名の定義
const QUEUE_NAME = QUEUE_NAMES.ARTICLE;

/**
 * 記事生成を行う (async/awaitを使用)
 * @param transcript 文字起こしテキスト
 * @param summary 要約テキスト
 * @returns 生成された記事テキスト
 */
async function generateArticle(transcript: string, summary: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  console.log(`Starting article generation: Transcript length=${transcript.length}, Summary length=${summary.length}`);

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'anthropic/claude-3-7-sonnet-20250219', // Use Claude 3 Opus
        messages: [
          {
            role: 'system',
            content: '文字起こしと要約から記事を生成する専門家です。'
          },
          {
            role: 'user',
            content: `以下の文字起こしと要約から、読みやすく構造化された記事を生成してください。

## 文字起こし:
${transcript}

## 要約:
${summary}

## 指示:
- 記事には適切な見出しをつけてください
- 内容を論理的に整理し、セクションに分けてください
- 要約の内容を中心に、文字起こしから重要な詳細を追加してください
- 読者が理解しやすいように、専門用語があれば簡潔に説明してください
- 記事の最後に簡潔なまとめを追加してください
- マークダウン形式で出力してください`
          }
        ],
        temperature: 0.7,
        max_tokens: 4000
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const article = response.data.choices[0].message.content;
    console.log(`Article generation completed: Article length=${article.length}`);
    return article;
  } catch (error: any) {
    console.error('Error calling OpenRouter API:', error);
    if (error.response) {
      console.error('OpenRouter API Response:', error.response.data);
    }
    throw new Error(`Failed to generate article: ${error.message}`);
  }
}

/**
 * BullMQワーカーのプロセッサ関数 (Article)
 * @param job BullMQジョブオブジェクト
 */
const articleProcessor = async (job: Job<JobData>) => {
  console.log(`[Article Worker] Received job ${job.id}:`, JSON.stringify(job.data, null, 2));
  const { recordId } = job.data;

  try {
    console.log(`[${QUEUE_NAME}] Processing job ${job.id} for record ${recordId}`);

    // 処理状態の更新 (PROCESSING, step: ARTICLE)
    await prisma.record.update({
      where: { id: recordId },
      data: {
        status: Status.PROCESSING,
        processing_step: 'ARTICLE',
        processing_progress: 85, // Progress indicating article generation start
        error: null
      }
    });
    console.log(`[${recordId}] Status updated to PROCESSING (ARTICLE)`);

    // 文字起こしと要約結果を取得
    const record = await prisma.record.findUnique({
      where: { id: recordId },
      select: { transcript_text: true, summary_text: true }
    });

    if (!record || !record.transcript_text || !record.summary_text) {
      throw new Error(`Transcript or summary text not found for record ${recordId}`);
    }

    // 記事生成処理
    console.log(`Starting article generation for record: ${recordId}`);
    await job.updateProgress(90); // Update progress before API call
    const article = await generateArticle(record.transcript_text, record.summary_text);
    await job.updateProgress(95); // Update progress after API call

    // 結果をデータベースに保存
    await prisma.record.update({
      where: { id: recordId },
      data: {
        article_text: article,
        status: Status.DONE, // Final status
        processing_step: null,
        processing_progress: 100 // Mark as 100% complete
      }
    });
    console.log(`[${recordId}] Successfully saved article to DB`);

    console.log(`[${recordId}] Article job ${job.id} completed successfully`);
    return { success: true };

  } catch (error) {
    console.error(`[${QUEUE_NAME}] Error processing job ${job?.id} for record ${job?.data?.recordId}:`, error);
    if (job?.data?.recordId) {
      try {
        await prisma.record.update({
          where: { id: job.data.recordId },
          data: {
            status: Status.ERROR,
            error: error instanceof Error ? error.message : String(error),
            processing_step: 'ARTICLE', // Indicate error happened during article generation
            processing_progress: null
          }
        });
        console.error(`[${job.data.recordId}] Updated record status to ERROR during article generation`);
      } catch (dbError: any) {
        console.error(`[${job.data.recordId}] CRITICAL: Failed to update record status to ERROR during article generation:`, dbError);
      }
    }
    throw error; // Rethrow error to notify BullMQ
  }
};

// --- BullMQ Worker Initialization ---
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('REDIS_URL environment variable is not set. Worker cannot start.');
  process.exit(1);
}

const workerConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 10000
});

workerConnection.on('error', (err: Error) => {
  console.error(`[${QUEUE_NAME}] Worker Redis connection error:`, err);
  process.exit(1);
});

workerConnection.on('connect', () => {
    console.log(`[${QUEUE_NAME}] Worker successfully connected to Redis.`);
});

console.log(`[${QUEUE_NAME}] Initializing worker...`);

const worker = new Worker(QUEUE_NAME, articleProcessor, {
  connection: workerConnection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '1'), // Lower concurrency for potentially heavier task
  limiter: {
    max: 5, // Limit API calls if necessary
    duration: 1000
  }
});

// アイドル状態検出と自動シャットダウン
let lastJobTime = Date.now();
let isProcessingJob = false;

worker.on('active', () => {
  lastJobTime = Date.now();
  isProcessingJob = true;
  console.log(`[${QUEUE_NAME}] Job processing started. Worker active.`);
});

worker.on('completed', (job: Job, result: any) => {
  console.log(`[${QUEUE_NAME}] Job ${job.id} completed successfully.`);
  lastJobTime = Date.now();
  isProcessingJob = false;
});

worker.on('failed', (job: Job | undefined, error: Error) => {
  console.error(`[${QUEUE_NAME}] Job ${job?.id} failed:`, error);
  lastJobTime = Date.now();
  isProcessingJob = false;
});

worker.on('error', (error: Error) => {
  console.error(`[${QUEUE_NAME}] Worker encountered an error:`, error);
});

worker.on('ready', () => {
  console.log(`[${QUEUE_NAME}] Worker is ready and listening for jobs.`);
});

console.log(`[${QUEUE_NAME}] Worker started. Node version: ${process.version}`);

// アイドル状態を定期的にチェック（1分ごと）
const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '600000'); // デフォルト10分 (ミリ秒)
const IDLE_CHECK_INTERVAL = 60 * 1000; // 1分 (ミリ秒)

console.log(`[${QUEUE_NAME}] Idle timeout set to ${IDLE_TIMEOUT / 1000 / 60} minutes.`);
console.log(`[${QUEUE_NAME}] Idle check interval set to ${IDLE_CHECK_INTERVAL / 1000} seconds.`);

const idleCheckInterval = setInterval(async () => {
  console.log(`[${QUEUE_NAME}] Performing idle check...`);
  // 現在のキュー状態を確認
  try {
    const queue = new Queue<JobData>(QUEUE_NAME, { connection: workerConnection });
    const waitingCount = await queue.getWaitingCount();
    const activeCount = await queue.getActiveCount();
    const delayedCount = await queue.getDelayedCount();
    const timeSinceLastJob = Date.now() - lastJobTime;
    
    console.log(`[${QUEUE_NAME}] Idle check - Waiting: ${waitingCount}, Active: ${activeCount}, Delayed: ${delayedCount}, Last job: ${Math.floor(timeSinceLastJob / 1000 / 60)}min ago, Processing: ${isProcessingJob}`);
    
    // ジョブがなく、最後のジョブから一定時間経過した場合は自動シャットダウン
    if (waitingCount === 0 && activeCount === 0 && delayedCount === 0 && !isProcessingJob && (timeSinceLastJob > IDLE_TIMEOUT)) {
      console.log(`[${QUEUE_NAME}] No jobs and idle for ${Math.floor(timeSinceLastJob / 1000 / 60)} minutes (threshold: ${IDLE_TIMEOUT / 1000 / 60} min). Shutting down worker to save resources.`);
      clearInterval(idleCheckInterval);
      await worker.close();
      await prisma.$disconnect();
      console.log(`[${QUEUE_NAME}] Worker gracefully shut down due to inactivity.`);
      process.exit(0);
    } else {
      console.log(`[${QUEUE_NAME}] Worker is active or has pending jobs, or idle time is within threshold. Keeping worker alive.`);
    }
    
    await queue.close();
  } catch (error) {
    console.error(`[${QUEUE_NAME}] Error during idle check:`, error);
  }
}, IDLE_CHECK_INTERVAL);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`[${QUEUE_NAME}] SIGTERM received, closing worker...`);
  clearInterval(idleCheckInterval);
  await worker.close();
  await prisma.$disconnect();
  console.log(`[${QUEUE_NAME}] Worker closed.`);
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log(`[${QUEUE_NAME}] SIGINT received, closing worker...`);
  clearInterval(idleCheckInterval);
  await worker.close();
  await prisma.$disconnect();
  console.log(`[${QUEUE_NAME}] Worker closed.`);
  process.exit(0);
});
