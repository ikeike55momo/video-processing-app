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
exports.initRedisClient = initRedisClient;
exports.getRedisClient = getRedisClient;
exports.addJob = addJob;
exports.getJob = getJob;
exports.completeJob = completeJob;
exports.failJob = failJob;
exports.getQueueStats = getQueueStats;
exports.requeueStuckJobs = requeueStuckJobs;
const redis_1 = require("redis");
const dotenv = __importStar(require("dotenv"));
const crypto = __importStar(require("crypto"));
dotenv.config();
let redisClient;
/**
 * Redisクライアントを初期化する
 * @returns {Promise<RedisClient>} Redisクライアント
 */
function initRedisClient() {
    return __awaiter(this, void 0, void 0, function* () {
        let retryCount = 0;
        const maxRetries = 5;
        const retryDelay = 3000; // 3秒に増やす
        
        while (retryCount < maxRetries) {
            try {
                const url = process.env.REDIS_URL;
                if (!url) {
                    console.error('Missing REDIS_URL environment variable');
                    return null;
                }
                
                // URLがredissで始まる場合はSSL接続
                const isSSL = url.startsWith('rediss://');
                console.log(`Redis接続を開始します (試行 ${retryCount + 1}/${maxRetries}): ${url.replace(/:[^:]*@/, ':***@')}`);
                console.log(`SSL接続: ${isSSL}`);
                console.log(`Node環境: ${process.env.NODE_ENV}`);
                
                // SSL接続の場合は証明書検証をスキップするオプションを追加
                // タイムアウト設定を増やす
                const options = {
                    url: url,
                    socket: {
                        tls: isSSL,
                        rejectUnauthorized: false, // 自己署名証明書を許可
                        connectTimeout: 30000,     // 接続タイムアウトを30秒に設定
                        timeout: 30000,            // 操作タイムアウトを30秒に設定
                        keepAlive: 5000            // キープアライブを5秒ごとに設定
                    },
                    // リトライ戦略を設定
                    retry: {
                        retries: 3,
                        factor: 2,
                        minTimeout: 1000,
                        maxTimeout: 15000
                    }
                };
                
                console.log('Redisクライアントを作成中...');
                redisClient = (0, redis_1.createClient)(options);
                
                // エラーイベントハンドラを追加
                redisClient.on('error', (err) => {
                    console.error('Redisエラー発生:', err);
                });
                
                // 再接続イベントハンドラを追加
                redisClient.on('reconnecting', () => {
                    console.log('Redisに再接続中...');
                });
                
                console.log('Redisに接続中...');
                yield redisClient.connect();
                console.log('Redisに正常に接続しました');
                
                // 接続テスト
                try {
                    const pingResult = yield redisClient.ping();
                    console.log(`Redis PING結果: ${pingResult}`);
                } catch (pingError) {
                    console.error('Redis PING失敗:', pingError);
                    throw pingError; // 再試行のためにエラーをスロー
                }
                
                return redisClient;
            } catch (error) {
                retryCount++;
                console.error(`Redisクライアント初期化エラー (試行 ${retryCount}/${maxRetries}):`, error);
                if (error.code) {
                    console.error(`エラーコード: ${error.code}`);
                }
                if (error.message) {
                    console.error(`エラーメッセージ: ${error.message}`);
                }
                
                // 最大リトライ回数に達した場合
                if (retryCount >= maxRetries) {
                    console.error(`Redis接続の最大リトライ回数(${maxRetries})に達しました。`);
                    throw error;
                }
                
                // リトライ前に待機
                console.log(`${retryDelay}ミリ秒後に再試行します...`);
                yield new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    });
}
/**
 * Redisクライアントを取得する
 * 未接続の場合は自動的に接続する
 */
function getRedisClient() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!redisClient || !redisClient.isOpen) {
            yield initRedisClient();
        }
        return redisClient;
    });
}
/**
 * キューにジョブを追加する
 * @param queue キュー名
 * @param data ジョブデータ
 * @returns ジョブID
 */
function addJob(queue, data) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const client = yield getRedisClient();
            if (!client) {
                console.warn(`Redis client unavailable, skipping job addition to queue ${queue}`);
                // Redisが利用できない場合でもジョブIDを返す
                return `job-${crypto.randomBytes(8).toString('hex')}`;
            }
            
            // ジョブIDを生成
            const jobId = `job-${crypto.randomBytes(8).toString('hex')}`;
            // 15分後の処理期限を設定
            const processingDeadline = Date.now() + 15 * 60 * 1000;
            const jobData = Object.assign(Object.assign({}, data), { id: jobId, createdAt: Date.now(), processingDeadline, retryCount: data.retryCount || 0 });
            // キューにジョブを追加（左側に追加）
            yield client.lPush(queue, JSON.stringify(jobData));
            console.log(`Job added to queue ${queue}:`, jobId);
            return jobId;
        } catch (error) {
            console.error('Error adding job to queue:', error);
            // エラーが発生した場合でもジョブIDを返す
            return `job-${crypto.randomBytes(8).toString('hex')}`;
        }
    });
}
/**
 * キューからジョブを取得し、処理中キューに移動する
 * @param queue キュー名
 * @returns ジョブデータまたはnull
 */
function getJob(queue) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const client = yield getRedisClient();
            if (!client) {
                console.warn(`Redis client unavailable, skipping job retrieval from queue ${queue}`);
                return null;
            }
            
            // 処理中キューの名前
            const processingQueue = `${queue}:processing`;
            
            // キューの右側からジョブを取得し、処理中キューの左側に追加
            const result = yield client.rPopLPush(queue, processingQueue);
            if (!result) {
                return null;
            }
            
            try {
                return JSON.parse(result);
            }
            catch (error) {
                console.error('Error parsing job data:', error);
                // 不正なデータの場合は処理中キューから削除
                yield client.lRem(processingQueue, 1, result);
                return null;
            }
        } catch (error) {
            console.error('Error getting job from queue:', error);
            return null; // エラーが発生した場合はnullを返す
        }
    });
}
/**
 * 処理が完了したジョブを処理中キューから削除する
 * @param queue キュー名
 * @param jobId ジョブID
 * @returns 削除に成功したかどうか
 */
function completeJob(queue, jobId) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield getRedisClient();
        // 処理中キューの名前
        const processingQueue = `${queue}:processing`;
        // 処理中キューからジョブを探す
        const jobs = yield client.lRange(processingQueue, 0, -1);
        for (const jobStr of jobs) {
            try {
                const job = JSON.parse(jobStr);
                if (job.id === jobId) {
                    // ジョブを見つけたら処理中キューから削除
                    yield client.lRem(processingQueue, 1, jobStr);
                    // 完了ログキューに追加（履歴として保持）
                    yield client.lPush(`${queue}:completed`, jobStr);
                    // 完了ログの長さを制限（最新の100件のみ保持）
                    yield client.lTrim(`${queue}:completed`, 0, 99);
                    console.log(`Job completed and removed: ${jobId}`);
                    return true;
                }
            }
            catch (error) {
                console.error('Error parsing job data during completion:', error);
                continue;
            }
        }
        return false;
    });
}
/**
 * 処理に失敗したジョブを処理する
 * @param queue キュー名
 * @param jobId ジョブID
 * @param maxRetries 最大リトライ回数
 * @returns リトライ状況
 */
function failJob(queue_1, jobId_1) {
    return __awaiter(this, arguments, void 0, function* (queue, jobId, maxRetries = 3) {
        const client = yield getRedisClient();
        // 処理中キューの名前
        const processingQueue = `${queue}:processing`;
        // 処理中キューからジョブを探す
        const jobs = yield client.lRange(processingQueue, 0, -1);
        for (const jobStr of jobs) {
            try {
                const job = JSON.parse(jobStr);
                if (job.id === jobId) {
                    // ジョブを見つけたら処理中キューから削除
                    yield client.lRem(processingQueue, 1, jobStr);
                    // リトライカウントを増やす
                    const retryCount = (job.retryCount || 0) + 1;
                    if (retryCount <= maxRetries) {
                        // リトライ回数が上限以下なら再度キューに追加
                        const updatedJob = Object.assign(Object.assign({}, job), { retryCount });
                        // リトライの遅延を設定（指数バックオフ）
                        const delayMs = Math.pow(2, retryCount) * 1000;
                        // 遅延時間後にキューに再追加
                        setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                            yield client.lPush(queue, JSON.stringify(updatedJob));
                            console.log(`Job ${jobId} scheduled for retry ${retryCount} after ${delayMs}ms`);
                        }), delayMs);
                        return { retried: true, retryCount };
                    }
                    else {
                        // 最大リトライ回数を超えた場合は失敗キューに追加
                        yield client.lPush(`${queue}:failed`, jobStr);
                        console.log(`Job ${jobId} failed after ${maxRetries} retries`);
                        return { retried: false, failed: true };
                    }
                }
            }
            catch (error) {
                console.error('Error parsing job data during failure handling:', error);
                continue;
            }
        }
        return { retried: false, failed: false };
    });
}
/**
 * キュー内のジョブ数を取得する
 * @param queue キュー名
 * @returns 各ステータスのジョブ数
 */
function getQueueStats(queue) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield getRedisClient();
        const [pending, processing, failed, completed] = yield Promise.all([
            client.lLen(queue),
            client.lLen(`${queue}:processing`),
            client.lLen(`${queue}:failed`),
            client.lLen(`${queue}:completed`),
        ]);
        return {
            pending,
            processing,
            failed,
            completed,
        };
    });
}
/**
 * 処理中のままになっているジョブを再キューに戻す
 * （サーバー再起動時などに実行する）
 * @param queue キュー名
 * @param olderThanMs 処理デッドラインからの経過時間（ミリ秒）
 * @returns 再キューに入れたジョブ数
 */
function requeueStuckJobs(queue_1) {
    return __awaiter(this, arguments, void 0, function* (queue, olderThanMs = 5 * 60 * 1000) {
        const client = yield getRedisClient();
        const processingQueue = `${queue}:processing`;
        // 処理中キューのジョブをすべて取得
        const jobs = yield client.lRange(processingQueue, 0, -1);
        let requeuedCount = 0;
        const now = Date.now();
        for (const jobStr of jobs) {
            try {
                const job = JSON.parse(jobStr);
                // 処理期限を過ぎているかチェック
                if (job.processingDeadline && (now - job.processingDeadline) > olderThanMs) {
                    // 処理中キューから削除
                    yield client.lRem(processingQueue, 1, jobStr);
                    // リトライカウントを増やす
                    const updatedJob = Object.assign(Object.assign({}, job), { retryCount: (job.retryCount || 0) + 1 });
                    // メインキューに再追加
                    yield client.lPush(queue, JSON.stringify(updatedJob));
                    requeuedCount++;
                    console.log(`Requeued stuck job: ${job.id}`);
                }
            }
            catch (error) {
                console.error('Error processing stuck job:', error);
                continue;
            }
        }
        console.log(`Requeued ${requeuedCount} stuck jobs for queue ${queue}`);
        return requeuedCount;
    });
}
