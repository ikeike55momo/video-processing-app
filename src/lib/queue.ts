import { createClient, RedisClientType } from 'redis';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';

dotenv.config();

/**
 * ジョブデータのインターフェース
 */
export interface JobData {
  id: string;
  type: 'transcription' | 'summary' | 'article';
  fileKey: string;
  recordId: string;
  retryCount?: number;
  createdAt?: number;
  processingDeadline?: number;
}

let redisClient: RedisClientType;

/**
 * Redisクライアントを初期化する
 */
export async function initRedisClient() {
  const url = process.env.REDIS_URL;
  
  if (!url) {
    console.error('Missing REDIS_URL environment variable');
    throw new Error('Missing REDIS_URL environment variable');
  }
  
  redisClient = createClient({
    url: url,
  });
  
  // エラーハンドリング
  redisClient.on('error', (err) => {
    console.error('Redis Error:', err);
  });
  
  // 接続
  await redisClient.connect();
  console.log('Connected to Redis');
  
  return redisClient;
}

/**
 * Redisクライアントを取得する
 * 未接続の場合は自動的に接続する
 */
export async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient || !redisClient.isOpen) {
    await initRedisClient();
  }
  return redisClient;
}

/**
 * キューにジョブを追加する
 * @param queue キュー名
 * @param data ジョブデータ
 * @returns ジョブID
 */
export async function addJob(queue: string, data: Omit<JobData, 'id' | 'createdAt' | 'processingDeadline'>): Promise<string> {
  const client = await getRedisClient();
  
  // ジョブIDを生成
  const jobId = `job-${crypto.randomBytes(8).toString('hex')}`;
  
  // 15分後の処理期限を設定
  const processingDeadline = Date.now() + 15 * 60 * 1000;
  
  const jobData: JobData = {
    ...data,
    id: jobId,
    createdAt: Date.now(),
    processingDeadline,
    retryCount: data.retryCount || 0,
  };
  
  // キューにジョブを追加（左側に追加）
  await client.lPush(queue, JSON.stringify(jobData));
  
  console.log(`Job added to queue ${queue}:`, jobId);
  return jobId;
}

/**
 * キューからジョブを取得し、処理中キューに移動する
 * @param queue キュー名
 * @returns ジョブデータまたはnull
 */
export async function getJob(queue: string): Promise<JobData | null> {
  const client = await getRedisClient();
  
  // 処理中キューの名前
  const processingQueue = `${queue}:processing`;
  
  // キューの右側からジョブを取得し、処理中キューの左側に追加
  const result = await client.rPopLPush(queue, processingQueue);
  
  if (!result) {
    return null;
  }
  
  try {
    return JSON.parse(result) as JobData;
  } catch (error) {
    console.error('Error parsing job data:', error);
    // 不正なデータの場合は処理中キューから削除
    await client.lRem(processingQueue, 1, result);
    return null;
  }
}

/**
 * 処理が完了したジョブを処理中キューから削除する
 * @param queue キュー名
 * @param jobId ジョブID
 * @returns 削除に成功したかどうか
 */
export async function completeJob(queue: string, jobId: string): Promise<boolean> {
  const client = await getRedisClient();
  
  // 処理中キューの名前
  const processingQueue = `${queue}:processing`;
  
  // 処理中キューからジョブを探す
  const jobs = await client.lRange(processingQueue, 0, -1);
  
  for (const jobStr of jobs) {
    try {
      const job = JSON.parse(jobStr) as JobData;
      
      if (job.id === jobId) {
        // ジョブを見つけたら処理中キューから削除
        await client.lRem(processingQueue, 1, jobStr);
        
        // 完了ログキューに追加（履歴として保持）
        await client.lPush(`${queue}:completed`, jobStr);
        
        // 完了ログの長さを制限（最新の100件のみ保持）
        await client.lTrim(`${queue}:completed`, 0, 99);
        
        console.log(`Job completed and removed: ${jobId}`);
        return true;
      }
    } catch (error) {
      console.error('Error parsing job data during completion:', error);
      continue;
    }
  }
  
  return false;
}

/**
 * 処理に失敗したジョブを処理する
 * @param queue キュー名
 * @param jobId ジョブID
 * @param maxRetries 最大リトライ回数
 * @returns リトライ状況
 */
export async function failJob(queue: string, jobId: string, maxRetries = 3): Promise<{ retried: boolean, retryCount?: number, failed?: boolean }> {
  const client = await getRedisClient();
  
  // 処理中キューの名前
  const processingQueue = `${queue}:processing`;
  
  // 処理中キューからジョブを探す
  const jobs = await client.lRange(processingQueue, 0, -1);
  
  for (const jobStr of jobs) {
    try {
      const job = JSON.parse(jobStr) as JobData;
      
      if (job.id === jobId) {
        // ジョブを見つけたら処理中キューから削除
        await client.lRem(processingQueue, 1, jobStr);
        
        // リトライカウントを増やす
        const retryCount = (job.retryCount || 0) + 1;
        
        if (retryCount <= maxRetries) {
          // リトライ回数が上限以下なら再度キューに追加
          const updatedJob: JobData = {
            ...job,
            retryCount,
          };
          
          // リトライの遅延を設定（指数バックオフ）
          const delayMs = Math.pow(2, retryCount) * 1000;
          
          // 遅延時間後にキューに再追加
          setTimeout(async () => {
            await client.lPush(queue, JSON.stringify(updatedJob));
            console.log(`Job ${jobId} scheduled for retry ${retryCount} after ${delayMs}ms`);
          }, delayMs);
          
          return { retried: true, retryCount };
        } else {
          // 最大リトライ回数を超えた場合は失敗キューに追加
          await client.lPush(`${queue}:failed`, jobStr);
          console.log(`Job ${jobId} failed after ${maxRetries} retries`);
          return { retried: false, failed: true };
        }
      }
    } catch (error) {
      console.error('Error parsing job data during failure handling:', error);
      continue;
    }
  }
  
  return { retried: false, failed: false };
}

/**
 * キュー内のジョブ数を取得する
 * @param queue キュー名
 * @returns 各ステータスのジョブ数
 */
export async function getQueueStats(queue: string): Promise<{ pending: number, processing: number, failed: number, completed: number }> {
  const client = await getRedisClient();
  
  const [pending, processing, failed, completed] = await Promise.all([
    client.lLen(queue),
    client.lLen(`${queue}:processing`),
    client.lLen(`${queue}:failed`),
    client.lLen(`${queue}:completed`),
  ]);
  
  return {
    pending,
    processing,
    failed,
    completed,
  };
}

/**
 * 処理中のままになっているジョブを再キューに戻す
 * （サーバー再起動時などに実行する）
 * @param queue キュー名
 * @param olderThanMs 処理デッドラインからの経過時間（ミリ秒）
 * @returns 再キューに入れたジョブ数
 */
export async function requeueStuckJobs(queue: string, olderThanMs = 5 * 60 * 1000): Promise<number> {
  const client = await getRedisClient();
  const processingQueue = `${queue}:processing`;
  
  // 処理中キューのジョブをすべて取得
  const jobs = await client.lRange(processingQueue, 0, -1);
  let requeuedCount = 0;
  
  const now = Date.now();
  
  for (const jobStr of jobs) {
    try {
      const job = JSON.parse(jobStr) as JobData;
      
      // 処理期限を過ぎているかチェック
      if (job.processingDeadline && (now - job.processingDeadline) > olderThanMs) {
        // 処理中キューから削除
        await client.lRem(processingQueue, 1, jobStr);
        
        // リトライカウントを増やす
        const updatedJob: JobData = {
          ...job,
          retryCount: (job.retryCount || 0) + 1,
        };
        
        // メインキューに再追加
        await client.lPush(queue, JSON.stringify(updatedJob));
        requeuedCount++;
        
        console.log(`Requeued stuck job: ${job.id}`);
      }
    } catch (error) {
      console.error('Error processing stuck job:', error);
      continue;
    }
  }
  
  console.log(`Requeued ${requeuedCount} stuck jobs for queue ${queue}`);
  return requeuedCount;
}
