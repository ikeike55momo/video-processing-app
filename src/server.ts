import express, { Request, Response, NextFunction, Application, RequestHandler } from 'express';
import dotenv from 'dotenv';
import { PrismaClient, Status } from '@prisma/client';
import { generateUploadUrl } from './lib/storage';
import { processRecord } from './lib/processor';
import { getFileSize } from './lib/file-utils';
import { getTranscriptionStatus } from './lib/transcription';
import { getJobStatus } from './lib/job-queue';
import { socketManager } from './lib/socket-manager';
import cors from 'cors';
import { errorHandler as customErrorHandler } from './middleware/error-handler';

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// Expressアプリケーションの作成
const app: Application = express();
const PORT = process.env.PORT || 3001;

// CORSの設定
const allowedOrigins = [
  'http://localhost:3000',
  'https://ririaru-stg.cloud',
  'https://api.ririaru-stg.cloud',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // originがnullの場合（サーバー間リクエストなど）は許可
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// JSONボディパーサーの設定
app.use(express.json({ limit: '50mb' }));

// URLエンコードされたボディパーサーの設定
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ヘルスチェックエンドポイント
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WebSocketサーバーの初期化
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// WebSocketマネージャーの設定
socketManager.init(server);

// カスタムリクエストハンドラー型の定義
type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<any>;

// APIルート

// アップロード用URLを生成するエンドポイント
const uploadUrlHandler: AsyncRequestHandler = async (req, res, next) => {
  try {
    const { fileName, contentType, fileSize } = req.body;
    
    console.log(`アップロードURL生成リクエスト: filename=${fileName}, contentType=${contentType}, fileSize=${fileSize}`);
    
    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'ファイル名とコンテンツタイプが必要です' });
    }

    console.log(`アップロードリクエスト: ${fileName} (${contentType}, ${fileSize || 'サイズ不明'})`);
    
    // ファイル名からファイルキーを生成
    const fileKey = `uploads/${Date.now()}-${fileName}`;
    
    // 署名付きURLを生成
    const uploadData = await generateUploadUrl(fileKey, contentType);
    console.log("生成されたアップロードデータ:", JSON.stringify(uploadData, null, 2));
    
    // fileUrlがnullまたはundefinedの場合、フォールバックとしてurlを使用
    const fileUrl = uploadData.publicUrl || uploadData.url;
    console.log(`使用するfileUrl: ${fileUrl}`);
    
    // fileUrlが存在しない場合はフォールバック値を使用
    if (!fileUrl) {
      console.error('有効なファイルURLが生成されませんでした。フォールバックURLを使用します。');
      const fallbackUrl = `https://pub-70c06e6cdf134c4ea4d0adf14d3a6b16.r2.dev/uploads/temp-${Date.now()}-${fileName}`;
      console.log('フォールバックURL:', fallbackUrl);
      
      // 新しいレコードをデータベースに作成（フォールバックURLを使用）
      const record = await prisma.record.create({
        data: {
          file_url: fallbackUrl,
          file_key: fileKey,
          r2_bucket: uploadData.bucket || '',
          status: Status.UPLOADED
        }
      });

      res.status(200).json({
        uploadUrl: uploadData.url,
        key: uploadData.key,
        recordId: record.id,
        fileUrl: fallbackUrl
      });
      return;
    }
    
    console.log(`生成されたURL: ${fileUrl.substring(0, 50)}...`);
    console.log(`ファイルキー: ${uploadData.key}`);
    console.log('uploadData詳細:', {
      hasUrl: !!uploadData.url,
      hasPublicUrl: !!uploadData.publicUrl,
      fileUrl: fileUrl ? fileUrl.substring(0, 30) + '...' : 'null',
      key: uploadData.key,
      bucket: uploadData.bucket
    });
    
    // 新しいレコードをデータベースに作成
    const record = await prisma.record.create({
      data: {
        file_url: fileUrl,
        file_key: fileKey,
        r2_bucket: uploadData.bucket || '',
        status: Status.UPLOADED
      }
    });
    console.log(`レコード作成成功: ${record.id}`);
    
    res.status(200).json({
      uploadUrl: uploadData.url,
      key: uploadData.key,
      recordId: record.id,
      fileUrl: fileUrl
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({ error: 'Error generating upload URL', details: String(error) });
  }
};

// 処理を開始するエンドポイント
const processHandler: AsyncRequestHandler = async (req, res, next) => {
  try {
    const { recordId, fileKey, fileUrl } = req.body;
    
    console.log('処理開始リクエスト:', { recordId, fileKey, fileUrl });
    
    // パラメータのバリデーション
    if (!recordId && !fileKey && !fileUrl) {
      return res.status(400).json({ error: 'Record ID, File Key, or File URL is required' });
    }

    // レコードの検索条件を構築
    const whereCondition: any = {};
    if (recordId) {
      whereCondition.id = recordId;
    } else if (fileKey) {
      whereCondition.file_key = fileKey;
    } else if (fileUrl) {
      whereCondition.file_url = fileUrl;
    }

    // レコードの存在確認
    const record = await prisma.record.findFirst({ where: whereCondition });
    console.log('検索条件:', whereCondition);
    console.log('検索結果:', record);

    if (!record) {
      return res.status(404).json({ error: 'Record not found', searchCriteria: whereCondition });
    }

    if (record.status === Status.PROCESSING) {
      return res.status(400).json({ error: 'Record is already being processed' });
    }

    // 処理キューに追加
    const job = await processRecord({
      recordId: record.id,
      fileKey: record.file_key,
      fileUrl: record.file_url,
      bucket: record.r2_bucket
    });

    // ステータスを更新
    await prisma.record.update({ 
      where: { id: record.id }, 
      data: { status: Status.PROCESSING } 
    });

    res.status(200).json({ 
      message: 'Processing started',
      jobId: job.id
    });
  } catch (error) {
    console.error('Error starting processing:', error);
    res.status(500).json({ error: 'Error starting processing', details: String(error) });
  }
};

// レコードの詳細を取得するエンドポイント
const getRecordHandler: AsyncRequestHandler = async (req, res, next) => {
  try {
    const recordId = req.params.id;
    
    const record = await prisma.record.findUnique({ where: { id: recordId } });

    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    // 削除されたレコードは表示しない
    if (record.deleted_at) {
      return res.status(404).json({ error: 'Record not found or has been deleted' });
    }

    // レスポンスデータの整形
    const responseData = {
      id: record.id,
      fileUrl: record.file_url,
      fileKey: record.file_key,
      status: record.status,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      transcriptText: record.transcript_text,
      summaryText: record.summary_text,
      articleText: record.article_text,
      error: record.error,
      processingStep: record.processing_step,
      timestampsJson: record.timestamps_json
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error('Error retrieving record:', error);
    res.status(500).json({ error: 'Error retrieving record', details: String(error) });
  }
};

// レコード一覧を取得するエンドポイント
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

    res.status(200).json({
      records,
      pagination: {
        total: totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize)
      }
    });
  } catch (error) {
    console.error('Error fetching records:', error);
    res.status(500).json({ error: 'Error fetching records', details: String(error) });
  }
});

// レコードの処理を再開するエンドポイント
const restartRecordHandler: AsyncRequestHandler = async (req, res, next) => {
  try {
    const recordId = req.params.id;
    
    const record = await prisma.record.findUnique({ where: { id: recordId } });

    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    if (record.status === Status.PROCESSING) {
      return res.status(400).json({ error: 'Record is already being processed' });
    }

    // ファイルキーの存在確認
    if (!record.file_key) {
      return res.status(400).json({ error: 'Record has no associated file' });
    }

    // 処理キューに追加
    const job = await processRecord({
      recordId,
      fileKey: record.file_key,
      fileUrl: record.file_url,
      bucket: record.r2_bucket,
      // 処理をリセットするためのフラグ
      reset: true
    });

    // ステータスを更新
    await prisma.record.update({ 
      where: { id: recordId }, 
      data: { 
        status: Status.PROCESSING,
        error: null
      } 
    });

    res.status(200).json({ 
      message: 'Processing restarted',
      jobId: job.id
    });
  } catch (error) {
    console.error('Error restarting processing:', error);
    res.status(500).json({ error: 'Error restarting processing', details: String(error) });
  }
};

// ジョブのステータスを取得するエンドポイント
const getJobStatusHandler: AsyncRequestHandler = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    
    if (!jobId) {
      return res.status(400).json({ error: 'Job ID is required' });
    }

    const status = await getJobStatus(jobId);
    
    if (!status) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.status(200).json(status);
  } catch (error) {
    console.error('Error retrieving job status:', error);
    res.status(500).json({ error: 'Error retrieving job status', details: String(error) });
  }
};

// 文字起こしステータスを取得するエンドポイント
const getTranscriptionStatusHandler: AsyncRequestHandler = async (req, res, next) => {
  try {
    const { recordId } = req.params;
    
    if (!recordId) {
      return res.status(400).json({ error: 'Record ID is required' });
    }
    
    // レコードの存在確認
    const record = await prisma.record.findUnique({ where: { id: recordId } });
    
    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }
    
    // ステータスを更新
    await prisma.record.update({ 
      where: { id: recordId }, 
      data: { status: Status.PROCESSING } 
    });
    
    // ファイルサイズを取得（可能であれば）
    let fileSize: number | null = null;
    if (record.file_key) {
      try {
        fileSize = await getFileSize(record.file_key, record.r2_bucket);
      } catch (err) {
        console.warn(`Could not get file size for ${record.file_key}:`, err);
      }
    }
    
    // 文字起こしステータスを取得
    const status = await getTranscriptionStatus(recordId, fileSize);
    
    res.status(200).json(status);
  } catch (error) {
    console.error('Error retrieving transcription status:', error);
    res.status(500).json({ error: 'Error retrieving transcription status', details: String(error) });
  }
};

// エラーハンドリングミドルウェア
const errorHandler: express.ErrorRequestHandler = (err, req, res, next) => {
  customErrorHandler(err, req, res, next);
};

// ルートの登録
app.post('/api/upload-url', uploadUrlHandler);
app.post('/api/process', processHandler);
app.get('/api/record/:id', getRecordHandler);
app.post('/api/record/:id/restart', restartRecordHandler);
app.get('/api/job/:id/status', getJobStatusHandler);
app.get('/api/transcription/:id/status', getTranscriptionStatusHandler);
app.use(errorHandler);

export default server;
