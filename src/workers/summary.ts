import * as dotenv from 'dotenv';
import { PrismaClient, Status } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { queueManager, QUEUE_NAMES, JobData } from '../lib/bull-queue';
import { GoogleGenerativeAI } from '@google/generative-ai'; // Import GoogleGenerativeAI

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// キュー名の定義
const QUEUE_NAME = QUEUE_NAMES.SUMMARY;
const ARTICLE_QUEUE = QUEUE_NAMES.ARTICLE;

/**
 * テキストの要約を行う (async/awaitを使用)
 * @param text 要約対象のテキスト
 * @returns 要約結果
 */
async function summarizeText(text: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  // Gemini APIの初期化
  const genAI = new GoogleGenerativeAI(apiKey);

  // 環境変数からモデル名を取得（デフォルトはgemini-2.0-flash）
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  console.log(`Using Gemini model: ${modelName}`);

  // モデルの取得
  const model = genAI.getGenerativeModel({ model: modelName });

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

  console.log(`Starting summary process: Text length=${text.length} characters`);

  // 要約の生成
  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const summary = response.text();
    console.log(`Summary process completed: Summary length=${summary.length} characters`);
    return summary;
  } catch (error: any) { // Explicitly type error as any or Error
    console.error('Error generating summary:', error);
    throw new Error(`Failed to generate summary: ${error.message}`);
  }
}

/**
 * BullMQワーカーのプロセッサ関数 (Summary)
 * @param job BullMQジョブオブジェクト
 */
const summaryProcessor = async (job: Job<JobData>) => {
  console.log(`[Summary Worker] Received job ${job.id}:`, JSON.stringify(job.data, null, 2));
  const { recordId, fileKey } = job.data; // fileKey might be needed for context or future steps

  try {
    console.log(`[${QUEUE_NAME}] Processing job ${job.id} for record ${recordId}`);

    // 処理状態の更新 (PROCESSING, step: SUMMARY)
    await prisma.record.update({
      where: { id: recordId },
      data: {
        status: Status.PROCESSING,
        processing_step: 'SUMMARY',
        processing_progress: 55, // Progress indicating summary start
        error: null
      }
    });
    console.log(`[${recordId}] Status updated to PROCESSING (SUMMARY)`);

    // 文字起こし結果を取得
    const record = await prisma.record.findUnique({
      where: { id: recordId },
      select: { transcript_text: true }
    });

    if (!record || !record.transcript_text) {
      throw new Error(`Transcript text not found for record ${recordId}`);
    }

    // 要約処理
    console.log(`Starting summary for transcript of length: ${record.transcript_text.length}`);
    await job.updateProgress(60); // Update progress before calling API
    const summary = await summarizeText(record.transcript_text);
    await job.updateProgress(90); // Update progress after API call

    // 結果をデータベースに保存
    await prisma.record.update({
      where: { id: recordId },
      data: {
        summary_text: summary,
        status: Status.SUMMARIZED,
        processing_step: null,
        processing_progress: 100 // Mark as 100% for this stage
      }
    });
    console.log(`[${recordId}] Successfully saved summary to DB`);

    // 次のキュー (Article) にジョブを追加
    await queueManager.addJob(ARTICLE_QUEUE, {
      type: 'article',
      recordId: recordId,
      fileKey: fileKey // Pass fileKey along
    });
    console.log(`[${recordId}] Successfully added job to article queue`);

    console.log(`[${recordId}] Summary job ${job.id} completed successfully`);
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
            processing_step: 'SUMMARY', // Indicate error happened during summary
            processing_progress: null
          }
        });
        console.error(`[${job.data.recordId}] Updated record status to ERROR during summary`);
      } catch (dbError: any) {
        console.error(`[${job.data.recordId}] CRITICAL: Failed to update record status to ERROR during summary:`, dbError);
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

const worker = new Worker(QUEUE_NAME, summaryProcessor, {
  connection: workerConnection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'),
  limiter: {
    max: 10,
    duration: 1000
  }
});

worker.on('completed', (job: Job, result: any) => {
  console.log(`[${QUEUE_NAME}] Job ${job.id} completed successfully.`);
});

worker.on('failed', (job: Job | undefined, error: Error) => {
  console.error(`[${QUEUE_NAME}] Job ${job?.id} failed:`, error);
});

worker.on('error', (error: Error) => {
  console.error(`[${QUEUE_NAME}] Worker encountered an error:`, error);
});

worker.on('ready', () => {
  console.log(`[${QUEUE_NAME}] Worker is ready and listening for jobs.`);
});

console.log(`[${QUEUE_NAME}] Worker started. Node version: ${process.version}`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`[${QUEUE_NAME}] SIGTERM received, closing worker...`);
  await worker.close();
  await prisma.$disconnect();
  console.log(`[${QUEUE_NAME}] Worker closed.`);
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log(`[${QUEUE_NAME}] SIGINT received, closing worker...`);
  await worker.close();
  await prisma.$disconnect();
  console.log(`[${QUEUE_NAME}] Worker closed.`);
  process.exit(0);
});
