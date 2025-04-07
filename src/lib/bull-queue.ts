import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

// Redis接続情報
const redisUrl = process.env.REDIS_URL || '';
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  connectTimeout: 10000
});

// グローバルイベントエミッター（進捗通知用）
export const jobEvents = new EventEmitter();

// キュー名の定義
export const QUEUE_NAMES = {
  TRANSCRIPTION: 'transcription',
  SUMMARY: 'summary',
  ARTICLE: 'article'
};

// ジョブデータのインターフェース
export interface JobData {
  id: string;
  recordId: string;
  fileKey: string;
  type: 'transcription' | 'summary' | 'article';
  metadata?: Record<string, any>;
  createdAt?: number;
}

// ジョブ進捗データのインターフェース
export interface JobProgress {
  progress: number;
  status: string;
  message?: string;
  timestamp: number;
}

// キューのオプション
const defaultQueueOptions = {
  connection,
  defaultJobOptions: {
    attempts: 3,               // 最大再試行回数
    backoff: {
      type: 'exponential',     // 指数関数的バックオフ
      delay: 60 * 1000         // 初回再試行までの遅延（ミリ秒）
    },
    timeout: 120 * 60 * 1000,   // ジョブタイムアウト（120分）
    removeOnComplete: false,   // 完了ジョブを保持（デバッグ用）
    removeOnFail: false,       // 失敗ジョブを保持（デバッグ用）
    stalledInterval: 60000     // 停滞ジョブの検出間隔（60秒）
  }
};

// キューマネージャークラス
export class QueueManager {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private schedulers: Map<string, any> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();

  /**
   * キューを初期化する
   * @param queueName キュー名
   * @param processor ジョブ処理関数
   */
  initQueue(queueName: string, processor?: (job: Job) => Promise<any>) {
    // キューが既に存在する場合は何もしない
    if (this.queues.has(queueName)) {
      return this.queues.get(queueName)!;
    }

    // キューを作成
    const queue = new Queue(queueName, defaultQueueOptions);
    this.queues.set(queueName, queue);

    // キューイベントを作成（進捗通知用） - 専用の接続オプションを使用
    const queueEventsConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null, // QueueEventsにはnullが必要
      enableReadyCheck: false,
      connectTimeout: 10000
    });
    const queueEvents = new QueueEvents(queueName, { connection: queueEventsConnection });
    this.queueEvents.set(queueName, queueEvents);

    // イベントリスナーを設定
    queueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`Job ${jobId} completed with result:`, returnvalue);
      jobEvents.emit(`job:completed:${jobId}`, { jobId, result: returnvalue });
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`Job ${jobId} failed with reason:`, failedReason);
      jobEvents.emit(`job:failed:${jobId}`, { jobId, error: failedReason });
    });

    queueEvents.on('progress', ({ jobId, data }) => {
      console.log(`Job ${jobId} reported progress:`, data);
      jobEvents.emit(`job:progress:${jobId}`, { jobId, progress: data });
    });

    // プロセッサが指定されている場合はワーカーを作成
    if (processor) {
      // スケジューラを作成（タイムアウトジョブの管理用）
      // const scheduler = new QueueScheduler(queueName, { connection });
      // this.schedulers.set(queueName, scheduler);

      // ワーカーを作成
      const worker = new Worker(queueName, processor, {
        connection,
        autorun: true,
        concurrency: 2, // 同時実行数
        stalledInterval: 60000, // 停滞ジョブの検出間隔を60秒に設定（デフォルトは30秒）
        maxStalledCount: 3, // 最大停滞回数を3回に設定（デフォルトは1回）
      });

      // ワーカーイベントリスナーを設定
      worker.on('completed', (job) => {
        console.log(`Worker completed job ${job.id}`);
      });

      worker.on('failed', (job, error) => {
        console.error(`Worker failed job ${job?.id}:`, error);
      });

      worker.on('error', (error) => {
        console.error(`Worker error:`, error);
      });

      this.workers.set(queueName, worker);
    }

    return queue;
  }

  /**
   * キューを取得する
   * @param queueName キュー名
   */
  getQueue(queueName: string): Queue | undefined {
    return this.queues.get(queueName);
  }

  /**
   * ジョブを追加する
   * @param queueName キュー名
   * @param data ジョブデータ
   * @param options ジョブオプション
   */
  async addJob(
    queueName: string,
    data: Omit<JobData, 'id' | 'createdAt'>,
    options: any = {}
  ): Promise<string> {
    const queue = this.getQueue(queueName) || this.initQueue(queueName);

    // ジョブIDを生成
    const jobId = `job-${crypto.randomBytes(8).toString('hex')}`;

    // ジョブデータを作成
    const jobData: JobData = {
      ...data,
      id: jobId,
      createdAt: Date.now(),
    };

    // ファイルサイズに基づく優先度を設定
    let priority = 3; // デフォルト優先度
    if (data.metadata?.fileSize) {
      const fileSize = data.metadata.fileSize;
      if (fileSize < 10 * 1024 * 1024) priority = 1;      // 10MB未満
      else if (fileSize < 100 * 1024 * 1024) priority = 2; // 100MB未満
    }

    // ジョブを追加
    await queue.add(data.type, jobData, {
      ...defaultQueueOptions.defaultJobOptions,
      ...options,
      jobId,
      priority,
    });

    console.log(`Job added to queue ${queueName}:`, jobId);
    return jobId;
  }

  /**
   * ジョブの進捗を更新する
   * @param job ジョブ
   * @param progress 進捗（0-100）
   * @param status ステータス
   * @param message メッセージ
   */
  async updateJobProgress(
    job: Job,
    progress: number,
    status: string,
    message?: string
  ): Promise<void> {
    const progressData: JobProgress = {
      progress,
      status,
      message,
      timestamp: Date.now(),
    };

    await job.updateProgress(progressData);
    jobEvents.emit(`job:progress:${job.id}`, { jobId: job.id, progress: progressData });
  }

  /**
   * キューの統計情報を取得する
   * @param queueName キュー名
   */
  async getQueueStats(queueName: string) {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * すべてのキューをクリーンアップする
   */
  async cleanup() {
    for (const [name, worker] of this.workers.entries()) {
      console.log(`Closing worker for queue ${name}...`);
      await worker.close();
    }

    for (const [name, scheduler] of this.schedulers.entries()) {
      console.log(`Closing scheduler for queue ${name}...`);
      await scheduler.close();
    }

    for (const [name, queueEvents] of this.queueEvents.entries()) {
      console.log(`Closing queue events for queue ${name}...`);
      // QueueEventsインスタンスを閉じれば、内部で使用されている接続も閉じられるはず
      await queueEvents.close();
    }

    for (const [name, queue] of this.queues.entries()) {
      console.log(`Closing queue ${name}...`);
      await queue.close();
    }

    console.log('All queues cleaned up');
  }

  /**
   * デッドジョブをチェックして再キューに入れる
   * @param queueName キュー名
   * @param olderThanMs 処理デッドラインからの経過時間（ミリ秒）
   */
  async checkForDeadJobs(queueName: string, olderThanMs = 2 * 60 * 60 * 1000): Promise<number> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      console.warn(`Queue ${queueName} not found for dead job check, initializing it`);
      this.initQueue(queueName);
      return 0;
    }

    const activeJobs = await queue.getJobs(['active']);
    const now = Date.now();
    let requeued = 0;

    for (const job of activeJobs) {
      const processedOn = job.processedOn;
      if (processedOn && now - processedOn > olderThanMs) {
        console.log(`Dead job detected: ${job.id}, running time: ${(now - processedOn) / 1000 / 60} minutes`);

        // ジョブを失敗としてマーク
        await job.moveToFailed(new Error('Job timed out'), 'health-check');

        // 再キューイング
        const jobData = job.data;
        const attempts = job.opts.attempts || 0;
        
        if (attempts < 3) { // 最大再試行回数を確認
          await this.addJob(queueName, jobData, {
            ...job.opts,
            attempts: attempts + 1,
          });
          
          console.log(`Job ${job.id} requeued`);
          requeued++;
        } else {
          console.log(`Job ${job.id} exceeded maximum retry attempts`);
        }
      }
    }

    return requeued;
  }
}

// シングルトンインスタンス
export const queueManager = new QueueManager();

// 定期的にデッドジョブをチェック（15分ごと）
if (typeof setInterval !== 'undefined') {
  setInterval(async () => {
    try {
      for (const queueName of Object.values(QUEUE_NAMES)) {
        const requeued = await queueManager.checkForDeadJobs(queueName);
        if (requeued > 0) {
          console.log(`Requeued ${requeued} dead jobs from queue ${queueName}`);
        }
      }
    } catch (error) {
      console.error('Error checking for dead jobs:', error);
    }
  }, 15 * 60 * 1000);
}
