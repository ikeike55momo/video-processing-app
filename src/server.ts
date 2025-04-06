import express from 'express';
// RequestHandler をインポートしない (型推論に任せる)
import type { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { addJob } from './lib/queue';
import { generateUploadUrl, getDownloadUrl } from './lib/storage';
import path from 'path';
import http from 'http';
import { queueManager, QUEUE_NAMES } from './lib/bull-queue';
import { socketManager } from './lib/socket-manager';
import cors from 'cors';

// 環境変数の読み込み
dotenv.config();

// Expressアプリケーションの初期化
const app = express();
const PORT = process.env.PORT || 3000;

// HTTPサーバーの作成
const server = http.createServer(app);

// Socket.IOサーバーの初期化
socketManager.initialize(server);

// BullMQキューの初期化
queueManager.initQueue(QUEUE_NAMES.TRANSCRIPTION);
queueManager.initQueue(QUEUE_NAMES.SUMMARY);
queueManager.initQueue(QUEUE_NAMES.ARTICLE);

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// JSON形式のリクエストボディを解析
app.use(express.json());

// CORSミドルウェアの設定
const corsOptions = {
  origin: function(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    const allowedOrigins = ['https://vpm.ririaru-stg.cloud', 'https://video-frontend-nextjs-app.onrender.com', 'https://video-processing-frontend.onrender.com'];
    // undefinedの場合はサーバー間リクエスト（Postmanなど）
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, true); // 開発中は全てのオリジンを許可
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};

// グローバルCORS設定
app.use(cors(corsOptions));

// ルートエンドポイント - APIの情報を返す
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    message: "Video Processing API",
    version: "1.0.0",
    endpoints: {
      health: "/api/health",
      healthcheck: "/api/healthcheck",
      uploadUrl: "/api/upload-url",
      process: "/api/process",
      records: "/api/records/:id"
    }
  });
});

// ヘルスチェックエンドポイント
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 追加のヘルスチェックエンドポイント（Render用）
app.get('/api/healthcheck', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// アップロード用URLを生成するエンドポイント
app.post('/api/upload-url', async (req: Request, res: Response) => {
  try {
    // --- 古い未完了レコードの削除処理を追加 ---
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const deletedRecords = await prisma.record.deleteMany({
        where: {
          status: {
            in: ['UPLOADED', 'PROCESSING'], // UPLOADED または PROCESSING
          },
          created_at: {
            lt: twentyFourHoursAgo, // 24時間以上前
          },
          deleted_at: null, // まだ削除されていないもの
        },
      });
      if (deletedRecords.count > 0) {
        console.log(`Deleted ${deletedRecords.count} old incomplete records.`);
      }
    } catch (deleteError) {
      console.error("Error deleting old incomplete records:", deleteError);
      // 削除エラーは続行可能とする
    }
    // --- 削除処理ここまで ---

    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
       res.status(400).json({
        error: 'Missing required fields',
        details: 'fileName and contentType are required'
      });
       return;
    }

    // 署名付きURLの生成
    const uploadData = await generateUploadUrl(fileName, contentType);

    // 新しいレコードをデータベースに作成
    const record = await prisma.record.create({
      data: {
        file_key: uploadData.key,
        r2_bucket: uploadData.bucket || '',
        status: 'UPLOADED',
        file_url: uploadData.fileUrl || uploadData.url
      }
    });

    res.status(200).json({
      uploadUrl: uploadData.url,
      recordId: record.id,
      fileKey: uploadData.key,
      fileUrl: uploadData.fileUrl || uploadData.url
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({
      error: 'Error generating upload URL',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 処理開始エンドポイント
app.post('/api/process', async (req: Request, res: Response) => { // 戻り値の型指定を削除
  try {
    const { recordId, fileUrl, fileKey } = req.body;

    if (!recordId) {
       res.status(400).json({ error: 'recordId is required' });
       return;
    }

    console.log(`処理リクエスト受信: recordId=${recordId}, fileUrl=${fileUrl ? 'あり' : 'なし'}, fileKey=${fileKey ? 'あり' : 'なし'}`);

    // レコードの存在確認
    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });

    if (!record) {
       res.status(404).json({ error: 'Record not found' });
       return;
    }

    // ★★★ 取得したレコードのステータスをログ出力 ★★★
    console.log(`[${recordId}] Found record. Current status: ${record.status}`);

    // ステータスチェックを修正 (PROCESSING を追加し、重複を削除)
    if (record.status === 'PROCESSING' || record.status === 'DONE' || record.status === 'TRANSCRIBED' || record.status === 'SUMMARIZED') {
      console.warn(`[${recordId}] Process request received but record status is already ${record.status}. Returning error.`);
       res.status(400).json({
        error: 'Record is already being processed or completed',
        status: record.status
      });
       return;
    }

    // fileKeyが提供されていれば更新
    if (fileKey && record.file_key !== fileKey) { // file_keyが異なる場合のみ更新
      console.log(`[${recordId}] Updating file_key from ${record.file_key} to ${fileKey}`);
      await prisma.record.update({
        where: { id: recordId },
        data: { file_key: fileKey }
      });
      console.log(`[${recordId}] file_key updated`);
    }

    // fileUrlが提供されていれば更新 (異なる場合のみ)
    if (fileUrl && record.file_url !== fileUrl) {
      console.log(`[${recordId}] Updating file_url`);
      await prisma.record.update({
        where: { id: recordId },
        data: { file_url: fileUrl }
      });
      console.log(`レコード ${recordId} のfile_urlを更新しました: ${fileUrl}`);
    }

    // 最新のレコード情報を取得
    const updatedRecord = await prisma.record.findUnique({
      where: { id: recordId }
    });

    if (!updatedRecord) {
      // このエラーは通常発生しないはずだが、念のため
      console.error(`[${recordId}] Failed to refetch record after potential updates.`);
       res.status(404).json({ error: 'Updated record not found after updates' });
       return;
    }

    // 文字起こしキューにジョブを追加
    const jobId = await addJob(QUEUE_NAMES.TRANSCRIPTION, {
      type: 'transcription',
      recordId: recordId,
      // fileKey または fileUrl を渡す。両方あれば fileKey を優先
      fileKey: updatedRecord.file_key || updatedRecord.file_url || ''
    });

    // ステータスを更新 (UPLOADEDの場合のみPROCESSINGに更新)
    const updateResult = await prisma.record.updateMany({
      where: {
        id: recordId,
        status: 'UPLOADED' // UPLOADED ステータスの場合のみ更新
      },
      data: { status: 'PROCESSING' }
    });

    // 更新が行われなかった場合 (競合が発生したか、既に処理中だった場合)
    if (updateResult.count === 0) {
        console.warn(`[${recordId}] Failed to update status to PROCESSING (possibly already processing or status changed).`);
        // 既に処理中である可能性が高いので、エラーではなく成功としてjobIdを返すことも検討できるが、
        // ここではエラーとして扱う（クライアント側でリロードや再確認を促す）
        // あるいは、最新のレコード情報を取得して、現在のステータスとjobIdを返す
        const currentRecord = await prisma.record.findUnique({ where: { id: recordId } });
         res.status(409).json({ // 409 Conflict を返す
             error: 'Record status could not be updated to PROCESSING. It might be already processing or its status changed.',
             currentStatus: currentRecord?.status || 'unknown',
             jobId: jobId // ジョブは追加されている可能性があるのでjobIdは返す
         });
         return;
    }
    console.log(`[${recordId}] Status updated to PROCESSING.`);

    res.status(200).json({
      message: 'Processing started',
      recordId: recordId,
      jobId: jobId // フロントエンドが追跡できるようにjobIdを返す
    });
  } catch (error) {
    console.error('Error starting process:', error);
    res.status(500).json({
      error: 'Error starting process',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// レコード情報取得エンドポイント
app.get('/api/records/:id', async (req: Request<{ id: string }>, res: Response) => { // 戻り値の型指定を削除
  try {
    const recordId = req.params.id;

    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });

    if (!record) {
       res.status(404).json({ error: 'Record not found' });
       return;
    }

    // ファイルダウンロードURLの生成（必要な場合）
    let fileUrl = record.file_url; // DBのURLをデフォルトとする
    if (record.file_key) {
      try {
        // R2から署名付きURLを取得試行
        fileUrl = await getDownloadUrl(record.file_key);
      } catch (urlError) {
        console.warn(`[${recordId}] Failed to get download URL for key ${record.file_key}:`, urlError);
        // エラーが発生してもDBのURLを返す
      }
    }

    res.status(200).json({
      id: record.id,
      status: record.status,
      processing_step: record.processing_step,
      processing_progress: record.processing_progress, // 進捗も返す
      transcript_text: record.transcript_text,
      timestamps_json: record.timestamps_json, // タイムスタンプも返す
      summary_text: record.summary_text,
      article_text: record.article_text,
      error: record.error,
      created_at: record.created_at,
      file_url: fileUrl, // 取得したURLまたはDBのURL
      file_name: record.file_name // ファイル名も返す
    });
  } catch (error) {
    console.error('Error retrieving record:', error);
    res.status(500).json({
      error: 'Error retrieving record',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// すべてのレコード取得エンドポイント
app.get('/api/records', async (req: Request, res: Response) => { // 戻り値の型指定を削除
  try {
    // クエリパラメータからページネーション情報を取得
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;

    // レコード総数の取得
    const totalCount = await prisma.record.count({
      where: { deleted_at: null }
    });

    // ページネーションを適用してレコードを取得
    const records = await prisma.record.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
      // 必要なフィールドを選択 (不要なデータは含めない)
      select: {
        id: true,
        file_name: true,
        status: true,
        created_at: true,
        error: true,
        processing_progress: true,
      }
    });

    // レスポンス
    res.status(200).json({
      records,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize)
      }
    });
  } catch (error) {
    console.error('Error retrieving records:', error);
    res.status(500).json({
      error: 'Error retrieving records',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 再試行エンドポイント
app.post('/api/records/:id/retry', async (req: Request<{ id: string }>, res: Response) => { // 戻り値の型指定を削除
  try {
    const recordId = req.params.id;
    const { step } = req.body; // 再開するステップ番号を受け取る

    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });

    if (!record) {
       res.status(404).json({ error: 'Record not found' });
       return;
    }

    // エラー状態でない場合は再試行しない（または特定のステップから再開する場合のロジックを追加）
    if (record.status !== 'ERROR' && !step) {
       res.status(400).json({
        error: 'Only records with ERROR status can be retried without specifying a step',
        status: record.status
      });
       return;
    }

    // 処理ステップに基づいてキューを選択
    let queueName: string;
    let jobType: 'transcription' | 'summary' | 'article';
    let targetStatus: 'PROCESSING' | 'TRANSCRIBED' | 'SUMMARIZED' = 'PROCESSING'; // デフォルト

    // 指定されたステップから再開する場合
    if (step) {
      switch (step) {
        case 1: // 文字起こしから
        case 2: // 文字起こしから (タイムスタンプは文字起こしの一部)
          queueName = QUEUE_NAMES.TRANSCRIPTION;
          jobType = 'transcription';
          targetStatus = 'PROCESSING';
          break;
        case 3: // 要約から
          queueName = QUEUE_NAMES.SUMMARY;
          jobType = 'summary';
          targetStatus = 'TRANSCRIBED'; // 要約開始前の状態
          break;
        case 4: // 記事生成から
          queueName = QUEUE_NAMES.ARTICLE;
          jobType = 'article';
          targetStatus = 'SUMMARIZED'; // 記事生成開始前の状態
          break;
        default:
           res.status(400).json({ error: `Invalid step number: ${step}` });
           return;
      }
    } else { // エラーからの再試行 (ステップ指定なし)
      switch (record.processing_step) { // エラー発生時のステップを見る
        case 'SUMMARY':
          queueName = QUEUE_NAMES.SUMMARY;
          jobType = 'summary';
          targetStatus = 'TRANSCRIBED';
          break;
        case 'ARTICLE':
          queueName = QUEUE_NAMES.ARTICLE;
          jobType = 'article';
          targetStatus = 'SUMMARIZED';
          break;
        default: // TRANSCRIPTION または DOWNLOAD など
          queueName = QUEUE_NAMES.TRANSCRIPTION;
          jobType = 'transcription';
          targetStatus = 'PROCESSING';
      }
    }

    console.log(`[${recordId}] Retrying job. Target queue: ${queueName}, Job type: ${jobType}, Target status: ${targetStatus}`);

    // ジョブをキューに追加
    const jobId = await addJob(queueName, {
      type: jobType,
      recordId: recordId,
      fileKey: record.file_key || record.file_url || '' // fileKeyまたはURLを渡す
    });

    // ステータスを更新 (エラーをクリアし、適切な開始前ステータスに)
    await prisma.record.update({
      where: { id: recordId },
      data: {
        status: targetStatus,
        error: null,
        processing_step: null, // ステップをクリア
        processing_progress: null // 進捗をクリア
      }
    });

    // すぐにPROCESSINGに更新 (キューに追加後)
     await prisma.record.update({
      where: { id: recordId },
      data: {
        status: 'PROCESSING',
      }
    });


    // 更新後のレコード情報を取得して返す
    const updatedRecord = await prisma.record.findUnique({ where: { id: recordId } });

    res.status(200).json({
      message: `Processing restarted from step ${step || 'last failed step'}`,
      recordId: recordId,
      jobId: jobId,
      queue: queueName,
      record: updatedRecord // 更新後のレコード情報を返す
    });
  } catch (error) {
    console.error('Error retrying process:', error);
    res.status(500).json({
      error: 'Error retrying process',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});


// WebSocketの進捗状況を取得するエンドポイント
app.get('/api/job-status/:jobId', async (req: Request<{ jobId: string }>, res: Response) => { // 戻り値の型指定を削除
  try {
    // console.log(`Job status request received for jobId: ${req.params.jobId}`); // Reduce log noise
    const jobId = req.params.jobId;

    if (!jobId) {
      console.error('Job status request missing jobId parameter');
       res.status(400).json({ error: 'Missing jobId parameter' });
       return;
    }

    // 各キューからジョブを検索
    let job = null;
    let foundInQueue = null;

    // console.log(`Searching for job ${jobId} in queues: ${Object.values(QUEUE_NAMES).join(', ')}`); // Reduce log noise

    for (const queueName of Object.values(QUEUE_NAMES)) {
      const queue = queueManager.getQueue(queueName);
      if (queue) {
        try {
          job = await queue.getJob(jobId);
          if (job) {
            foundInQueue = queueName;
            // console.log(`Found job ${jobId} in queue ${queueName}`); // Reduce log noise
            break;
          }
        } catch (queueError) {
          // キューからの取得エラーは警告レベルに留める
          console.warn(`Error getting job from queue ${queueName}:`, queueError);
        }
      } else {
        console.warn(`Queue ${queueName} not initialized`);
      }
    }

    // ジョブが見つからない場合、レコードIDとしてDBを検索
    if (!job) {
      // console.warn(`Job ${jobId} not found in any queue, trying to find record with id ${jobId}`); // Reduce log noise

      try {
        const record = await prisma.record.findUnique({
          where: { id: jobId }
        });

        if (record) {
          // console.log(`Found record with id ${jobId}`); // Reduce log noise

          // 処理状態に基づいて進捗を計算
          let progress = 0;
          let state = 'waiting'; // BullMQのステートに合わせる

          // ★★★ 修正: DBステータスに基づいた進捗計算 ★★★
          switch (record.status) {
            case 'UPLOADED':
              progress = 0;
              state = 'waiting';
              break;
            case 'PROCESSING':
              // PROCESSING中はDBの値を優先、なければステップに応じて推定
              progress = record.processing_progress ?? 25; // デフォルト25%
              // より詳細な推定（オプション）
              // if (record.processing_step === 'DOWNLOAD') progress = 5;
              // else if (record.processing_step === 'TRANSCRIPTION_AUDIO_EXTRACTION') progress = 10;
              // else if (record.processing_step?.startsWith('TRANSCRIPTION')) progress = record.processing_progress ?? 30; // 文字起こし中はDB値優先、なければ30
              // else if (record.processing_step?.startsWith('SUMMARY')) progress = record.processing_progress ?? 60; // 要約中はDB値優先、なければ60
              // else if (record.processing_step?.startsWith('ARTICLE')) progress = record.processing_progress ?? 85; // 記事生成中はDB値優先、なければ85
              state = 'active';
              break;
            case 'TRANSCRIBED':
              // 文字起こし完了 -> 要約処理中/待機中
              progress = 50; // 要約フェーズ開始点
              state = 'active'; // 全体プロセスとしてはまだアクティブ
              break;
            case 'SUMMARIZED':
              // 要約完了 -> 記事生成中/待機中
              progress = 75; // 記事生成フェーズ開始点
              state = 'active'; // 全体プロセスとしてはまだアクティブ
              break;
            case 'DONE':
              progress = 100;
              state = 'completed';
              break;
            case 'ERROR':
              progress = record.processing_progress ?? 0; // エラー発生時の進捗を保持、なければ0
              state = 'failed';
              break;
            default:
              state = 'unknown'; // 不明な状態
          }

          const response = {
            jobId,
            state,
            progress,
            // dataフィールドはBullMQのjob.dataに合わせる
            data: {
              recordId: record.id,
              status: record.status, // DBステータスも参考情報として含める
              processing_step: record.processing_step, // ステップ情報も追加
              error: record.error // エラー情報も追加
            },
            timestamp: Date.now()
          };

          // console.log(`Returning record status for ${jobId}:`, response); // Reduce log noise
           res.status(200).json(response);
           return;
        } else {
           // レコードも見つからない場合は404
           console.warn(`Record with id ${jobId} also not found in DB.`);
           res.status(404).json({ error: 'Job or Record not found' });
           return;
        }
      } catch (dbError) {
        console.error(`Error getting record with id ${jobId}:`, dbError);
        // DBエラーの場合は500を返す
         res.status(500).json({ error: 'Database error while searching for record' });
         return;
      }
    }

    // ジョブが見つかった場合
    try {
      const state = await job.getState();
      const progress = job.progress || 0; // BullMQの進捗

      const response = {
        jobId,
        state, // BullMQのジョブステート
        progress,
        queue: foundInQueue,
        data: job.data, // BullMQのジョブデータ
        timestamp: Date.now()
      };

      // console.log(`Returning job status for ${jobId}:`, response); // Reduce log noise
       res.status(200).json(response);
       return;

    } catch (jobError) {
      console.error(`Error getting job state for ${jobId}:`, jobError);
       res.status(500).json({
        error: 'Error getting job state',
        details: jobError instanceof Error ? jobError.message : 'Unknown error'
      });
       return;
    }
  } catch (error) {
    console.error('Error in job status endpoint:', error);
     res.status(500).json({
      error: 'Error getting job status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
     return;
  }
});


// 文字起こし処理を開始するエンドポイント (旧 /api/transcribe)
// 注意: このエンドポイントは /api/process に統合されたため、通常は不要
//       互換性のため、または特定のユースケースのために残す場合は注意が必要
app.post('/api/transcribe', async (req: Request, res: Response) => { // 戻り値の型指定を削除
   console.warn("Deprecated /api/transcribe endpoint called. Use /api/process instead.");
  try {
    const { fileKey, fileName, recordId } = req.body; // recordIdも受け取れるようにする

    if (!fileKey && !recordId) {
        res.status(400).json({
        error: 'Missing required fields',
        details: 'Either fileKey or recordId is required'
      });
        return;
    }

    let targetRecordId = recordId;
    let targetFileKey = fileKey;

    // recordId が提供された場合、レコードを検索して fileKey を取得
    if (recordId) {
        const existingRecord = await prisma.record.findUnique({ where: { id: recordId } });
        if (!existingRecord) {
             res.status(404).json({ error: `Record not found for provided recordId: ${recordId}` });
             return;
        }
        if (!existingRecord.file_key && !fileKey) {
              res.status(400).json({ error: `File key not found for record ${recordId} and not provided in request.` });
              return;
        }
        targetFileKey = existingRecord.file_key || fileKey; // DBのキーを優先、なければリクエストのキー
    } else {
        // recordId がなく fileKey のみの場合、新しいレコードを作成
        console.log(`Creating new record for fileKey: ${fileKey}`);
        const newRecord = await prisma.record.create({
          data: {
            file_key: fileKey,
            file_name: fileName || 'unknown', // ファイル名があれば使う
            status: 'UPLOADED',
            r2_bucket: process.env.R2_BUCKET_NAME || 'video-processing'
          }
        });
        targetRecordId = newRecord.id;
        console.log(`New record created: ${targetRecordId}`);
    }

    if (!targetRecordId || !targetFileKey) {
          res.status(500).json({ error: 'Failed to determine target recordId or fileKey.' });
          return;
    }


    // ジョブをキューに追加
    console.log(`Adding transcription job for record ${targetRecordId} with fileKey ${targetFileKey}`);
    const jobId = await queueManager.addJob(QUEUE_NAMES.TRANSCRIPTION, {
      type: 'transcription',
      fileKey: targetFileKey,
      recordId: targetRecordId,
      // metadata: { fileSize } // ファイルサイズはここでは不明
    });

    // ステータスを更新
    await prisma.record.update({
      where: { id: targetRecordId },
      data: { status: 'PROCESSING' }
    });

    // 202 Accepted を返すのが適切
    res.status(202).json({
      message: 'Transcription job accepted',
      jobId,
      recordId: targetRecordId
    });
  } catch (error) {
    console.error('Error in /api/transcribe:', error);
    res.status(500).json({
      error: 'Error starting transcription via /api/transcribe',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});


// サーバーの起動
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Node.jsバージョン:', process.version);
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? '設定されています' : '設定されていません');
  console.log('プロセスの作業ディレクトリ:', process.cwd());
});

// プロセス終了時の処理
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await queueManager.cleanup();
  await prisma.$disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await queueManager.cleanup();
  await prisma.$disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
