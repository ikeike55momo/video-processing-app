"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const dotenv = __importStar(require("dotenv"));
const queue_1 = require("./lib/queue");
const storage_1 = require("./lib/storage");
const axios = __importStar(require("axios"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
// TranscriptionServiceを先頭でインポート
// const { TranscriptionService } = require('./services/transcription-service');
let transcriptionService;
// 環境変数の読み込み
dotenv.config();
// Expressアプリケーションの初期化
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Prismaクライアントの初期化
// 注: Prismaクライアントの初期化を確実にするための修正
let prisma;
try {
  // Prismaクライアントの初期化前に環境変数を確認
  console.log('Node.jsバージョン:', process.version);
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? '設定されています' : '設定されていません');
  console.log('プロセスの作業ディレクトリ:', process.cwd());
  
  // Prismaクライアントをインポートする前に、prisma generateを実行
  const { execSync } = require('child_process');
  console.log('prisma generateを実行します...');
  try {
    execSync('npx prisma generate --schema=./prisma/schema.prisma', { 
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' }
    });
    console.log('prisma generateが正常に完了しました');
  } catch (genError) {
    console.error('prisma generateの実行中にエラーが発生しました:', genError);
  }
  
  // スキーマの場所を明示的に指定
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    }
  });
  console.log('Prismaクライアントが正常に初期化されました');
} catch (error) {
  console.error('Prismaクライアントの初期化に失敗しました:', error);
  process.exit(1); // 致命的なエラーなのでプロセスを終了
}
// JSON形式のリクエストボディを解析
app.use(express_1.default.json());
// 静的ファイルの提供（publicフォルダがある場合）
app.use(express_1.default.static('public'));
// CORSミドルウェア
app.use((req, res, next) => {
    // 環境変数から許可するオリジンを取得、設定がなければ全てのオリジンを許可
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
        ? process.env.ALLOWED_ORIGINS.split(',') 
        : ['http://localhost:3000', 'https://video-processing-frontend.onrender.com'];
    
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes('*'))) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }
    
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// ルートパスへのアクセスに対応
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'Video Processing API',
        version: '1.0.0',
        endpoints: {
            health: '/api/health',
            healthcheck: '/api/healthcheck',
            uploadUrl: '/api/upload-url',
            process: '/api/process',
            records: '/api/records/:id'
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
app.post('/api/upload-url', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { fileName, contentType } = req.body;
        if (!fileName || !contentType) {
            return res.status(400).json({
                error: 'Missing required fields',
                details: 'fileName and contentType are required'
            });
        }
        // 署名付きURLの生成
        const uploadData = yield (0, storage_1.generateUploadUrl)(fileName, contentType);
        // 新しいレコードをデータベースに作成
        const record = yield prisma.record.create({
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
    }
    catch (error) {
        console.error('Error generating upload URL:', error);
        res.status(500).json({
            error: 'Error generating upload URL',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}));
// 処理開始エンドポイント
app.post('/api/process', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { recordId } = req.body;
        if (!recordId) {
            return res.status(400).json({ error: 'recordId is required' });
        }
        // レコードの存在確認
        const record = yield prisma.record.findUnique({
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
        yield (0, queue_1.addJob)('transcription', {
            type: 'transcription',
            recordId: recordId,
            fileKey: record.file_key
        });
        // ステータスを更新
        yield prisma.record.update({
            where: { id: recordId },
            data: { status: 'PROCESSING' }
        });
        res.status(200).json({
            message: 'Processing started',
            recordId: recordId
        });
    }
    catch (error) {
        console.error('Error starting process:', error);
        res.status(500).json({
            error: 'Error starting process',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}));
// 文字起こしAPIエンドポイント
app.post('/api/transcribe', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { fileUrl } = req.body;
        
        if (!fileUrl) {
            return res.status(400).json({ error: 'fileUrlは必須です' });
        }
        
        console.log(`文字起こし処理を開始: ${fileUrl}`);
        
        // 一時ディレクトリを作成
        const tempDir = path.join(os.tmpdir(), 'transcription-' + crypto.randomBytes(6).toString('hex'));
        fs.mkdirSync(tempDir, { recursive: true });
        
        // ファイルをダウンロード
        const filePath = yield downloadFile(fileUrl, tempDir);
        console.log(`ファイルをダウンロードしました: ${filePath}`);
        
        // 文字起こし処理
        if (!transcriptionService) {
            console.log('TranscriptionServiceを初期化します');
            try {
                const { TranscriptionService } = require('./services/transcription-service');
                transcriptionService = new TranscriptionService();
            } catch (error) {
                console.error('TranscriptionServiceの初期化に失敗しました:', error);
                return res.status(500).json({ error: `TranscriptionServiceの初期化に失敗しました: ${error.message}` });
            }
        }
        const transcript = yield transcriptionService.transcribeAudio(filePath);
        
        // 一時ディレクトリを削除
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.log(`一時ディレクトリを削除しました: ${tempDir}`);
        } catch (err) {
            console.error(`一時ディレクトリの削除に失敗しました: ${tempDir}`, err);
        }
        
        return res.json({ transcript });
    } catch (error) {
        console.error('文字起こし処理エラー:', error);
        return res.status(500).json({ error: `文字起こし処理に失敗しました: ${error.message}` });
    }
}));

/**
 * ファイルURLからファイルをダウンロード
 * @param {string} fileUrl ファイルのURL
 * @param {string} tempDir 一時ディレクトリのパス
 * @returns {Promise<string>} ダウンロードしたファイルのパス
 */
function downloadFile(fileUrl, tempDir) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // URLの形式に応じた処理
            if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
                // 公開URLの場合、一時ファイルにダウンロード
                console.log('公開URLからファイルをダウンロードします');
                
                // ファイル名を取得
                const fileName = path.basename(new URL(fileUrl).pathname);
                const localFilePath = path.join(tempDir, fileName);
                
                console.log(`ファイルをダウンロード中: ${localFilePath}`);
                
                // ファイルをダウンロード
                const response = yield axios({
                    method: 'get',
                    url: fileUrl,
                    responseType: 'stream'
                });
                
                const writer = fs.createWriteStream(localFilePath);
                response.data.pipe(writer);
                
                yield new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
                
                console.log(`ファイルのダウンロード完了: ${localFilePath}`);
                return localFilePath;
            } else {
                throw new Error('サポートされていないURL形式です: ' + fileUrl);
            }
        } catch (error) {
            console.error('ファイルダウンロードエラー:', error);
            throw new Error(`ファイルのダウンロードに失敗しました: ${error.message}`);
        }
    });
}

// レコード情報取得エンドポイント
app.get('/api/records/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const recordId = req.params.id;
        const record = yield prisma.record.findUnique({
            where: { id: recordId }
        });
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }
        // ファイルダウンロードURLの生成（必要な場合）
        let fileUrl = null;
        if (record.file_key) {
            fileUrl = yield (0, storage_1.getDownloadUrl)(record.file_key);
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
    }
    catch (error) {
        console.error('Error retrieving record:', error);
        res.status(500).json({
            error: 'Error retrieving record',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}));
// すべてのレコード取得エンドポイント
app.get('/api/records', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // クエリパラメータからページネーション情報を取得
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 10;
        const skip = (page - 1) * pageSize;
        // レコード総数の取得
        const totalCount = yield prisma.record.count({
            where: { deleted_at: null }
        });
        // ページネーションを適用してレコードを取得
        const records = yield prisma.record.findMany({
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
    }
    catch (error) {
        console.error('Error retrieving records:', error);
        res.status(500).json({
            error: 'Error retrieving records',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}));
// 再試行エンドポイント
app.post('/api/records/:id/retry', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const recordId = req.params.id;
        const record = yield prisma.record.findUnique({
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
        let queueName;
        let jobType;
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
        yield (0, queue_1.addJob)(queueName, {
            type: jobType,
            recordId: recordId,
            fileKey: record.file_key
        });
        // ステータスを更新
        yield prisma.record.update({
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
    }
    catch (error) {
        console.error('Error retrying process:', error);
        res.status(500).json({
            error: 'Error retrying process',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}));
// サーバーを起動
app.listen(PORT, () => {
  console.log(`サーバーが起動しました。ポート: ${PORT}`);
  try {
    // TranscriptionServiceのダイナミックインポート
    const { TranscriptionService } = require('./services/transcription-service');
    transcriptionService = new TranscriptionService();
    console.log('TranscriptionService初期化完了');
  } catch (error) {
    console.error('TranscriptionServiceの初期化に失敗しました:', error);
  }
});

// モジュールとしてもエクスポート（他のファイルからインポートできるように）
module.exports = app;
