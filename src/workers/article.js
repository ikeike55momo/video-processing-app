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
const axios = require('axios');

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new client_1.PrismaClient();

// キュー名の定義
const QUEUE_NAME = 'article';

/**
 * 記事生成を行う
 * @param transcript 文字起こしテキスト
 * @param summary 要約テキスト
 * @returns 生成された記事テキスト
 */
function generateArticle(transcript, summary) {
    return __awaiter(this, void 0, void 0, function* () {
        // OpenRouter（Claude）APIを使用した実装
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
            throw new Error('OPENROUTER_API_KEY is missing');
        }

        console.log(`記事生成を開始: 文字起こし長=${transcript.length}文字, 要約長=${summary.length}文字`);
        
        try {
            // OpenRouter APIリクエスト - Promiseチェーンを使用
            return axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: 'anthropic/claude-3-opus:beta',  // Claude 3 Opusを使用
                    messages: [
                        {
                            role: 'system',
                            content: '文字起こしと要約から記事を生成する専門家です。'
                        },
                        {
                            role: 'user',
                            content: `以下の文字起こしと要約から、読みやすく構造化された記事を生成してください。

## 文字起こし:
${transcript}

## 要約:
${summary}

## 指示:
- 記事には適切な見出しをつけてください
- 内容を論理的に整理し、セクションに分けてください
- 要約の内容を中心に、文字起こしから重要な詳細を追加してください
- 読者が理解しやすいように、専門用語があれば簡潔に説明してください
- 記事の最後に簡潔なまとめを追加してください
- マークダウン形式で出力してください`
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 4000
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            )
            .then(response => {
                // レスポンスから記事テキストを抽出
                const article = response.data.choices[0].message.content;
                console.log(`記事生成が完了しました: 記事長=${article.length}文字`);
                return article;
            })
            .catch(error => {
                console.error('OpenRouter API呼び出しエラー:', error);
                if (error.response) {
                    console.error('OpenRouter APIレスポンス:', error.response.data);
                }
                throw new Error(`記事生成に失敗しました: ${error.message}`);
            });
        } catch (error) {
            console.error('OpenRouter API呼び出しエラー (try-catch):', error);
            throw new Error(`記事生成に失敗しました: ${error.message}`);
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
            
            console.log(`Processing article job ${job.id} for record ${job.recordId}`);
            
            // 処理状態の更新
            try {
                yield prisma.record.update({
                    where: { id: job.recordId },
                    data: { 
                        status: client_1.Status.PROCESSING,
                        processing_step: 'ARTICLE'
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
            
            // 文字起こしと要約結果を取得
            const record = yield prisma.record.findUnique({
                where: { id: job.recordId },
                select: { transcript_text: true, summary_text: true }
            });
            
            if (!record || !record.transcript_text || !record.summary_text) {
                throw new Error('Transcript or summary text not found');
            }
            
            // 記事生成処理
            console.log(`Starting article generation for record: ${job.recordId}`);
            
            // モック処理（デモ用）
            console.log(`[MOCK] Generating article from transcript(${record.transcript_text.length} chars) and summary(${record.summary_text.length} chars)`);
            const article = "# 記事タイトル\n\n## はじめに\n\nこれはデモの要約結果です。実際にはGemini APIを使用してテキスト要約を行います。\n\n## 内容\n\nこれはデモの記事です。実際にはClaudeなどのAIを使用して文字起こしと要約から記事を生成します。\n\n## まとめ\n\nこれはOpenRouterを使用した文章生成のデモです。";
            
            // 本番環境では実際にAPIを呼び出す
            // const article = yield generateArticle(record.transcript_text, record.summary_text);
            
            // 結果をデータベースに保存
            yield prisma.record.update({
                where: { id: job.recordId },
                data: {
                    article_text: article,
                    status: client_1.Status.DONE, // 列挙型を使用
                    processing_step: null
                }
            });
            
            // ジョブを完了としてマーク
            yield (0, queue_1.completeJob)(QUEUE_NAME, job.id);
            console.log(`Article job ${job.id} completed successfully`);
        }
        catch (error) {
            console.error('Error processing article job:', error);
            
            try {
                // ジョブIDがある場合のみリトライを実行
                if (job && job.id) {
                    try {
                        yield (0, queue_1.failJob)(QUEUE_NAME, job.id);
                    } catch (queueError) {
                        console.error('Failed to mark job as failed:', queueError);
                    }
                    
                    // エラーステータスを記録
                    try {
                        yield prisma.record.update({
                            where: { id: job.recordId },
                            data: {
                                status: client_1.Status.ERROR, // 列挙型を使用
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
            } catch (handlingError) {
                console.error('ジョブ処理中にエラーが発生しました:', handlingError);
                // jobが未定義の場合のエラーを防止
                if (typeof job === 'undefined') {
                    console.error('job変数が未定義です');
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
            console.log(`記事生成ワーカー起動: ${new Date().toISOString()}`);
            console.log(`Node環境: ${process.env.NODE_ENV}`);
            console.log(`ワーカータイプ: ${process.env.WORKER_TYPE || 'article'}`);
            
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
            
            console.log('記事生成ワーカーが正常に起動しました');
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
