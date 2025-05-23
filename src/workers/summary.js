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
// Redisクライアントの初期化
(async () => {
  try {
    const client = await (0, queue_1.initRedisClient)();
    if (client) {
      console.log('Redis client initialized successfully');
    } else {
      console.warn('Redis client initialization returned null, will retry when needed');
    }
  } catch (error) {
    console.error('Failed to initialize Redis client:', error);
    // エラーをログに出力するだけで、プロセスは終了しない
  }
})();
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
        // ここではGemini APIを使用する簡易的な実装
        // 実際の実装では適切なAPIクライアントを使用
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is missing');
        }
        // TODO: 実際のGemini API呼び出し実装
        // この例では単純なモックを返しています
        console.log(`[MOCK] Summarizing text of length: ${text.length}`);
        // モック応答（実際はAPIを使用）
        return "これはデモの要約結果です。実際にはGemini APIを使用してテキスト要約を行います。";
    });
}
/**
 * ジョブを処理する関数
 */
async function processJob() {
  try {
    // ジョブの取得
    const job = await (0, queue_1.getJob)(QUEUE_NAME);
    if (!job) {
      console.log('No jobs in queue. Waiting...');
      return;
    }
    
    console.log(`Processing summary job ${job.id} for record ${job.recordId}`);
    
    // 処理状態の更新
    try {
      await prisma.record.update({
        where: { id: job.recordId },
        data: { 
          status: 'PROCESSING',
          processing_step: 'SUMMARY'
        }
      });
    } catch (error) {
      if (error.code === 'P2025') {
        console.warn(`Record ${job.recordId} not found in database. Removing job from queue.`);
        await (0, queue_1.completeJob)(QUEUE_NAME, job.id);
        return;
      }
      throw error;
    }
    
    // 文字起こし結果を取得
    const record = await prisma.record.findUnique({
        where: { id: job.recordId },
        select: { transcript_text: true }
    });
    
    if (!record || !record.transcript_text) {
        throw new Error('Transcript text not found');
    }
    
    // 要約処理
    console.log(`Starting summary process for transcript of length: ${record.transcript_text.length}`);
    const summary = await summarizeText(record.transcript_text);
    
    // 結果をデータベースに保存
    await prisma.record.update({
        where: { id: job.recordId },
        data: {
            summary_text: summary,
            status: 'SUMMARIZED',
            processing_step: null
        }
    });
    
    // 記事生成キューにジョブを追加
    await (0, queue_1.addJob)(ARTICLE_QUEUE, {
        type: 'article',
        recordId: job.recordId,
        fileKey: job.fileKey
    });
    
    // ジョブを完了としてマーク
    await (0, queue_1.completeJob)(QUEUE_NAME, job.id);
    console.log(`Summary job ${job.id} completed successfully`);
  }
  catch (error) {
    console.error('Error processing summary job:', error);
    // ジョブIDがある場合のみリトライを実行
    if (job?.id) {
        await (0, queue_1.failJob)(QUEUE_NAME, job.id);
        // エラーステータスを記録
        try {
            await prisma.record.update({
                where: { id: job.recordId },
                data: {
                    status: 'ERROR',
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
}

/**
 * メインワーカー処理
 */
async function startWorker() {
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
        const client = await (0, queue_1.initRedisClient)();
        if (!client) {
            throw new Error('Redisクライアントの初期化に失敗しました');
        }
        console.log('Redisクライアント初期化完了');
        
        // プリズマクライアントの確認
        console.log('データベース接続を確認中...');
        await prisma.$connect();
        console.log('データベース接続確認完了');
        
        console.log('要約ワーカーが正常に起動しました');
        console.log('========================================');
        
        // 継続的にジョブを処理
        while (true) {
            try {
                await processJob();
            } catch (jobError) {
                console.error('ジョブ処理中にエラーが発生しました:', jobError);
                // ジョブエラーでは終了せず、次のジョブを処理
            }
            // 少し待機してからポーリング
            await new Promise(resolve => setTimeout(resolve, 1000));
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
}
// ワーカー開始
startWorker().catch(error => {
    console.error('Failed to start worker:', error);
    process.exit(1);
});
