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
// 環境変数の読み込み
dotenv.config();
// Expressアプリケーションの初期化
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Prismaクライアントの初期化
// 注: Prismaクライアントの初期化を確実にするための修正
let prisma;
try {
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
  console.log('Prismaクライアントが正常に初期化されました');
} catch (error) {
  console.error('Prismaクライアントの初期化に失敗しました:', error);
  // 再度Prisma Clientを生成して初期化を試みる
  try {
    const { execSync } = require('child_process');
    console.log('prisma generateを実行します...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    console.log('2回目の試行でPrismaクライアントが正常に初期化されました');
  } catch (retryError) {
    console.error('2回目のPrismaクライアント初期化にも失敗しました:', retryError);
    process.exit(1); // 致命的なエラーなのでプロセスを終了
  }
}
// JSON形式のリクエストボディを解析
app.use(express_1.default.json());
// CORSミドルウェア
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
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
// indexからインポートされるため、サーバー起動部分は削除
exports.default = app;
