const { Queue, Worker, Job, QueueEvents } = require('bullmq');
const { QueueScheduler } = require('bullmq');
const IORedis = require('ioredis');
const crypto = require('crypto');
const { EventEmitter } = require('events');

// Redis接続情報
const redisUrl = process.env.REDIS_URL || '';
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  connectTimeout: 10000
});

// グローバルイベントエミッター（進捗通知用）
const jobEvents = new EventEmitter();

// キュー名の定義
const QUEUE_NAMES = {
  TRANSCRIPTION: 'transcription-queue',
  SUMMARY: 'summary-queue',
  ARTICLE: 'article-queue'
};

// キューのオプション
const defaultQueueOptions = {
  connection,
  defaultJobOptions: {
    attempts: 3,               // 最大再試行回数
    backoff: {
      type: 'exponential',     // 指数関数的バックオフ
      delay: 60 * 1000         // 初回再試行までの遅延（ミリ秒）
    },
    timeout: 30 * 60 * 1000,   // ジョブタイムアウト（30分）
    removeOnComplete: false,   // 完了ジョブを保持（デバッグ用）
    removeOnFail: false        // 失敗ジョブを保持（デバッグ用）
  }
};

// キューマネージャークラス
class QueueManager {
  constructor() {
    this.queues = new Map();
    this.workers = new Map();
    this.schedulers = new Map();
    this.queueEvents = new Map();
  }

  /**
   * キューを初期化する
   * @param queueName キュー名
   * @param processor ジョブ処理関数
   */
  initQueue(queueName, processor) {
    // キューが既に存在する場合は何もしない
    if (this.queues.has(queueName)) {
      return this.queues.get(queueName);
    }

    // キューを作成
    const queue = new Queue(queueName, defaultQueueOptions);
    this.queues.set(queueName, queue);

    // キューイベントを作成（進捗通知用）
    const queueEvents = new QueueEvents(queueName, { connection });
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
      const scheduler = new QueueScheduler(queueName, { connection });
      this.schedulers.set(queueName, scheduler);

      // ワーカーを作成
      const worker = new Worker(queueName, processor, {
        connection,
        autorun: true,
        concurrency: 2, // 同時実行数
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
  getQueue(queueName) {
    return this.queues.get(queueName);
  }

  /**
   * ジョブを追加する
   * @param queueName キュー名
   * @param data ジョブデータ
   * @param options ジョブオプション
   */
  async addJob(queueName, data, options = {}) {
    const queue = this.getQueue(queueName) || this.initQueue(queueName);

    // ジョブIDを生成
    const jobId = `job-${crypto.randomBytes(8).toString('hex')}`;

    // ジョブデータを作成
    const jobData = {
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
  async updateJobProgress(job, progress, status, message) {
    const progressData = {
      progress,
      status,
      message,
      timestamp: Date.now(),
    };

    try {
      await job.updateProgress(progressData);
      console.log(`Job ${job.id} progress updated: ${progress}%`);
      return true;
    } catch (error) {
      console.error(`Failed to update job progress: ${error.message}`);
      return false;
    }
  }

  /**
   * ジョブを取得する
   * @param queueName キュー名
   * @param jobId ジョブID
   */
  async getJob(queueName, jobId) {
    const queue = this.getQueue(queueName) || this.initQueue(queueName);
    return await queue.getJob(jobId);
  }

  /**
   * ジョブを完了する
   * @param queueName キュー名
   * @param jobId ジョブID
   * @param result 結果
   */
  async completeJob(queueName, jobId, result) {
    const job = await this.getJob(queueName, jobId);
    if (job) {
      await job.moveToCompleted(result, queueName);
      return true;
    }
    return false;
  }

  /**
   * ジョブを失敗させる
   * @param queueName キュー名
   * @param jobId ジョブID
   * @param error エラー
   */
  async failJob(queueName, jobId, error) {
    const job = await this.getJob(queueName, jobId);
    if (job) {
      await job.moveToFailed(error, queueName);
      return true;
    }
    return false;
  }

  /**
   * ジョブをキャンセルする
   * @param queueName キュー名
   * @param jobId ジョブID
   */
  async cancelJob(queueName, jobId) {
    const job = await this.getJob(queueName, jobId);
    if (job) {
      await job.remove();
      return true;
    }
    return false;
  }

  /**
   * 全てのキューを閉じる
   */
  async closeAll() {
    for (const [name, worker] of this.workers.entries()) {
      console.log(`Closing worker: ${name}`);
      await worker.close();
    }

    for (const [name, scheduler] of this.schedulers.entries()) {
      console.log(`Closing scheduler: ${name}`);
      await scheduler.close();
    }

    for (const [name, queueEvents] of this.queueEvents.entries()) {
      console.log(`Closing queue events: ${name}`);
      await queueEvents.close();
    }

    for (const [name, queue] of this.queues.entries()) {
      console.log(`Closing queue: ${name}`);
      await queue.close();
    }

    console.log('All queues closed');
  }
}

// シングルトンインスタンス
const queueManager = new QueueManager();

// 定期的にデッドジョブをチェック（15分ごと）
setInterval(async () => {
  try {
    for (const queueName of Object.values(QUEUE_NAMES)) {
      const queue = queueManager.getQueue(queueName);
      if (queue) {
        const jobs = await queue.getJobs(['failed'], 0, 100);
        console.log(`Found ${jobs.length} failed jobs in queue ${queueName}`);
      }
    }
  } catch (error) {
    console.error('Error checking dead jobs:', error);
  }
}, 15 * 60 * 1000);

module.exports = {
  jobEvents,
  QUEUE_NAMES,
  queueManager
};
