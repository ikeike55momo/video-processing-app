import express from 'express';
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
      callback(null, false);
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
    const { fileName, contentType } = req.body;
    
    if (!fileName || !contentType) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'fileName and contentType are required'
      });
    }

    // 署名付きURLの生成
    const uploadData = await generateUploadUrl(fileName, contentType);
    
    // 新しいレコードをデータベースに作成
    const record = await prisma.record.create({
      data: {
        file_key: uploadData.key,
        r2_bucket: uploadData.bucket || '',
        status: 'UPLOADED',
        file_url: uploadData.url
      }
    });

    res.status(200).json({
      uploadUrl: uploadData.url,
      recordId: record.id,
      fileKey: uploadData.key
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
app.post('/api/process', async (req: Request, res: Response) => {
  try {
    const { recordId } = req.body;
    
    if (!recordId) {
      return res.status(400).json({ error: 'recordId is required' });
    }

    // レコードの存在確認
    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });

    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    if (record.status !== 'UPLOADED') {
      return res.status(400).json({ 
        error: 'Record is already being processed or completed',
        status: record.status
      });
    }

    // 文字起こしキューにジョブを追加
    await addJob('transcription', {
      type: 'transcription',
      recordId: recordId,
      fileKey: record.file_key || '' // nullの場合に空文字列を使用
    });

    // ステータスを更新
    await prisma.record.update({
      where: { id: recordId },
      data: { status: 'PROCESSING' }
    });

    res.status(200).json({ 
      message: 'Processing started',
      recordId: recordId
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
app.get('/api/records/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const recordId = req.params.id;
    
    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });

    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    // ファイルダウンロードURLの生成（必要な場合）
    let fileUrl = null;
    if (record.file_key) {
      fileUrl = await getDownloadUrl(record.file_key);
    }

    res.status(200).json({
      id: record.id,
      status: record.status,
      processing_step: record.processing_step,
      transcript_text: record.transcript_text,
      summary_text: record.summary_text,
      article_text: record.article_text,
      error: record.error,
      created_at: record.created_at,
      file_url: fileUrl
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
app.get('/api/records', async (req: Request, res: Response) => {
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
app.post('/api/records/:id/retry', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const recordId = req.params.id;
    
    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });

    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    if (record.status !== 'ERROR') {
      return res.status(400).json({ 
        error: 'Only records with ERROR status can be retried',
        status: record.status
      });
    }

    // 処理ステップに基づいてキューを選択
    let queueName: string;
    let jobType: 'transcription' | 'summary' | 'article';
    
    switch (record.processing_step) {
      case 'SUMMARY':
        queueName = 'summary';
        jobType = 'summary';
        break;
      case 'ARTICLE':
        queueName = 'article';
        jobType = 'article';
        break;
      default:
        // デフォルトは文字起こしから開始
        queueName = 'transcription';
        jobType = 'transcription';
    }

    // ジョブをキューに追加
    await addJob(queueName, {
      type: jobType,
      recordId: recordId,
      fileKey: record.file_key || '' // nullの場合に空文字列を使用
    });

    // ステータスを更新
    await prisma.record.update({
      where: { id: recordId },
      data: { 
        status: 'PROCESSING',
        error: null
      }
    });

    res.status(200).json({ 
      message: 'Processing restarted',
      recordId: recordId,
      queue: queueName
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
app.get('/api/job-status/:jobId', async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const { jobId } = req.params;
    
    // 各キューからジョブを検索
    let job = null;
    for (const queueName of Object.values(QUEUE_NAMES)) {
      const queue = queueManager.getQueue(queueName);
      if (queue) {
        job = await queue.getJob(jobId);
        if (job) break;
      }
    }
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const state = await job.getState();
    const progress = job.progress || 0;
    
    res.status(200).json({
      jobId,
      state,
      progress,
      data: job.data,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({
      error: 'Error getting job status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 文字起こし処理を開始するエンドポイント
app.post('/api/transcribe', async (req: Request, res: Response) => {
  try {
    const { fileKey, fileName } = req.body;
    
    if (!fileKey) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'fileKey is required'
      });
    }
    
    // 新しいレコードをデータベースに作成
    const record = await prisma.record.create({
      data: {
        file_key: fileKey,
        file_name: fileName || 'unknown',
        status: 'UPLOADED',
        r2_bucket: process.env.R2_BUCKET_NAME || 'video-processing'
      }
    });

    // ファイルサイズを取得（可能であれば）
    let fileSize: number | null = null;
    try {
      // ここでファイルサイズを取得するロジックを実装
      // 例: R2からファイルのメタデータを取得
    } catch (error) {
      console.warn('Failed to get file size:', error);
    }
    
    // ジョブをキューに追加
    const jobId = await queueManager.addJob(QUEUE_NAMES.TRANSCRIPTION, {
      type: 'transcription',
      fileKey,
      recordId: record.id,
      metadata: { fileSize }
    });
    
    // ステータスを更新
    await prisma.record.update({
      where: { id: record.id },
      data: { status: 'PROCESSING' }
    });
    
    res.status(200).json({
      message: 'Transcription job queued successfully',
      jobId,
      recordId: record.id
    });
  } catch (error) {
    console.error('Error starting transcription:', error);
    res.status(500).json({
      error: 'Error starting transcription',
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
