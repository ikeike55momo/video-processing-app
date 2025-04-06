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
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const client_1 = require("@prisma/client");
const queue_1 = require("../lib/queue");

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new client_1.PrismaClient();

// キュー名の定義
const QUEUE_NAME = 'summary';
const ARTICLE_QUEUE = 'article';

/**
 * テキストの要約を行う
 * @param text 要約対象のテキスト
 * @returns 要約結果
 */
function summarizeText(text) {
    return __awaiter(this, void 0, void 0, function* () {
        // Gemini APIを使用した実装
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is missing');
        }

        const { GoogleGenerativeAI } = require('@google/generative-ai');
        
        // Gemini APIの初期化
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // 環境変数からモデル名を取得（デフォルトはgemini-2.0-flash）
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        console.log(`Geminiモデルを使用: ${modelName}`);
        
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
        
        console.log(`要約処理を開始: テキスト長=${text.length}文字`);
        
        // 要約の生成
        try {
            // awaitを使わずにPromiseチェーンを使用
            return model.generateContent(prompt)
                .then(result => {
                    const response = result.response;
                    const summary = response.text();
                    console.log(`要約処理が完了しました: 要約長=${summary.length}文字`);
                    return summary;
                })
                .catch(error => {
                    console.error('要約生成エラー:', error);
                    throw new Error(`要約生成に失敗しました: ${error.message}`);
                });
        } catch (error) {
            console.error('要約生成エラー (try-catch):', error);
            throw new Error(`要約生成に失敗しました: ${error.message}`);
        }
    });
}

/**
 * ジョブを処理する関数
 */
function processJob() {
    return __awaiter(this, void 0, void 0, function* () {
        let job = null;
        try {
            // ジョブの取得
            job = yield (0, queue_1.getJob)(QUEUE_NAME);
            if (!job) {
                console.log('No jobs in queue. Waiting...');
                return;
            }
            
            console.log(`Processing summary job ${job.id} for record ${job.recordId}`);
            
            // 処理状態の更新
            try {
                yield prisma.record.update({
                    where: { id: job.recordId },
                    data: { 
                        status: client_1.Status.PROCESSING,
                        processing_step: 'SUMMARY'
                    }
                });
            } catch (error) {
                if (error.code === 'P2025') {
                    console.warn(`Record ${job.recordId} not found in database. Removing job from queue.`);
                    yield (0, queue_1.completeJob)(QUEUE_NAME, job.id);
                    return;
                }
                throw error;
            }
            
            // 文字起こし結果を取得
            const record = yield prisma.record.findUnique({
                where: { id: job.recordId },
                select: { transcript_text: true }
            });
            
            if (!record || !record.transcript_text) {
                throw new Error('Transcript text not found');
            }
            
            // 要約処理
            console.log(`Starting summary process for transcript of length: ${record.transcript_text.length}`);
            const summary = yield summarizeText(record.transcript_text);
            
            // 結果をデータベースに保存
            yield prisma.record.update({
                where: { id: job.recordId },
                data: {
                    summary_text: summary,
                    status: client_1.Status.SUMMARIZED,
                    processing_step: null
                }
            });
            
            // 記事生成キューにジョブを追加
            try {
                yield (0, queue_1.addJob)(ARTICLE_QUEUE, {
                    type: 'article',
                    recordId: job.recordId,
                    fileKey: job.fileKey
                });
                console.log(`記事生成ジョブをキューに追加しました: ${job.recordId}`);
            } catch (queueError) {
                console.error('記事生成ジョブのキューへの追加に失敗しました:', queueError);
                // キューエラーは無視して処理を続行
            }
            
            // ジョブを完了としてマーク
            try {
                yield (0, queue_1.completeJob)(QUEUE_NAME, job.id);
                console.log(`Summary job ${job.id} completed successfully`);
            } catch (completeError) {
                console.error('ジョブの完了マークに失敗しました:', completeError);
                // 完了マークエラーは無視して処理を続行
            }
        }
        catch (error) {
            console.error('Error processing summary job:', error);
            // ジョブIDがある場合のみリトライを実行
            if (job && job.id) {
                try {
                    yield (0, queue_1.failJob)(QUEUE_NAME, job.id);
                } catch (failError) {
                    console.error('ジョブの失敗マークに失敗しました:', failError);
                }
                
                // エラーステータスを記録
                try {
                    yield prisma.record.update({
                        where: { id: job.recordId },
                        data: {
                            status: client_1.Status.ERROR,
                            error: error instanceof Error ? error.message : String(error),
                            processing_step: null
                        }
                    });
                }
                catch (dbError) {
                    if (dbError.code === 'P2025') {
                        console.warn(`Record ${job.recordId} not found in database when updating error status.`);
                    } else {
                        console.error('Failed to update record status:', dbError);
                    }
                }
            }
        }
    });
}

/**
 * メインワーカー処理
 */
function startWorker() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('========================================');
            console.log(`要約ワーカー起動: ${new Date().toISOString()}`);
            console.log(`Node環境: ${process.env.NODE_ENV}`);
            console.log(`ワーカータイプ: ${process.env.WORKER_TYPE || 'summary'}`);
            
            // 環境変数の確認（機密情報は隠す）
            const redisUrl = process.env.REDIS_URL || '';
            console.log(`Redis URL設定: ${redisUrl.replace(/:[^:]*@/, ':***@')}`);
            
            // Redisクライアントの初期化
            console.log('Redisクライアントを初期化中...');
            const client = yield (0, queue_1.initRedisClient)();
            if (!client) {
                throw new Error('Redisクライアントの初期化に失敗しました');
            }
            console.log('Redisクライアント初期化完了');
            
            // プリズマクライアントの確認
            console.log('データベース接続を確認中...');
            yield prisma.$connect();
            console.log('データベース接続確認完了');
            
            console.log('要約ワーカーが正常に起動しました');
            console.log('========================================');
            
            // 継続的にジョブを処理
            while (true) {
                try {
                    yield processJob();
                } catch (jobError) {
                    console.error('ジョブ処理中にエラーが発生しました:', jobError);
                    // ジョブエラーでは終了せず、次のジョブを処理
                }
                // 少し待機してからポーリング
                yield new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        catch (error) {
            console.error('ワーカーで致命的なエラーが発生しました:', error);
            if (error.code) {
                console.error(`エラーコード: ${error.code}`);
            }
            if (error.message) {
                console.error(`エラーメッセージ: ${error.message}`);
            }
            if (error.stack) {
                console.error(`スタックトレース: ${error.stack}`);
            }
            process.exit(1);
        }
    });
}

// ワーカー開始
startWorker().catch(error => {
    console.error('Failed to start worker:', error);
    process.exit(1);
});
