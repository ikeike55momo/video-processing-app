import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { addJob } from './lib/queue';
import { generateUploadUrl, getDownloadUrl } from './lib/storage';
import path from 'path';

// 環境変数の読み込み
dotenv.config();

// Expressアプリケーションの初期化
const app = express();
const PORT = process.env.PORT || 3000;

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// JSON形式のリクエストボディを解析
app.use(express.json());

// CORSミドルウェア
app.use((req, res, next) => {
  // ALLOWED_ORIGINSが設定されている場合は、そのオリジンからのリクエストのみを許可
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];
  
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// ルートエンドポイント - APIの情報を返す
app.get('/', (req, res) => {
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
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 追加のヘルスチェックエンドポイント（Render用）
app.get('/api/healthcheck', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// アップロード用URLを生成するエンドポイント
app.post('/api/upload-url', async (req, res) => {
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
        r2_bucket: uploadData.bucket,
        status: 'UPLOADED'
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
app.post('/api/process', async (req, res) => {
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
      fileKey: record.file_key
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
app.get('/api/records/:id', async (req, res) => {
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
app.get('/api/records', async (req, res) => {
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
app.post('/api/records/:id/retry', async (req, res) => {
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
      fileKey: record.file_key
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

// indexからインポートされるため、サーバー起動部分は削除

export default app;
