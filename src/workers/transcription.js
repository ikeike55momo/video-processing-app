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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const client_1 = require("@prisma/client");
const queue_1 = require("../lib/queue");
const storage_1 = require("../lib/storage");
const child_process_1 = require("child_process");
const transcription_service_1 = require("../services/transcription-service");
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
const QUEUE_NAME = 'transcription';
const SUMMARY_QUEUE = 'summary';
// 一時ファイルディレクトリ
const TMP_DIR = process.env.TMP_DIR || '/tmp';
/**
 * 音声ファイルの文字起こしを行う
 * @param audioPath 音声ファイルパス
 * @returns 文字起こし結果
 */
async function transcribeAudio(audioPath) {
    try {
        // TranscriptionServiceのインスタンスを作成
        const transcriptionService = new transcription_service_1.TranscriptionService();
        // 文字起こし実行
        const transcription = await transcriptionService.transcribeAudio(audioPath);
        return transcription;
    } catch (error) {
        console.error('文字起こし処理中にエラーが発生しました:', error);
        throw error;
    }
}
/**
 * 大きなファイルを複数の小さなチャンクに分割して処理する
 * @param filePath ファイルパス
 * @returns 処理結果の配列
 */
async function processLargeFile(filePath) {
    // 一時ディレクトリの作成
    const workDir = path.join(TMP_DIR, `transcription-${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });
    try {
        // 動画ファイルから音声を抽出
        const audioPath = path.join(workDir, 'audio.mp3');
        console.log(`Extracting audio from ${filePath} to ${audioPath}`);
        // FFmpegを使用して音声抽出
        (0, child_process_1.execSync)(`ffmpeg -i "${filePath}" -q:a 0 -map a "${audioPath}" -y`, { stdio: 'inherit' });
        // 音声ファイルを分割（実際の実装ではファイルサイズに基づいて分割）
        // この例では簡易的に全体を処理
        const transcription = await transcribeAudio(audioPath);
        // 一時ファイルの削除
        fs.unlinkSync(audioPath);
        return [transcription];
    }
    catch (error) {
        console.error('Error processing file:', error);
        throw error;
    }
    finally {
        // 一時ディレクトリの削除
        try {
            fs.rmSync(workDir, { recursive: true, force: true });
        }
        catch (cleanupError) {
            console.error('Error cleaning up temp directory:', cleanupError);
        }
    }
}
/**
 * 文字起こしテキストからタイムスタンプを抽出する
 * @param transcription 文字起こしテキスト
 * @param audioPath 音声ファイルパス
 * @returns タイムスタンプデータ
 */
async function extractTimestamps(transcription, audioPath) {
    try {
        // TranscriptionServiceのインスタンスを作成
        const transcriptionService = new transcription_service_1.TranscriptionService();
        // タイムスタンプ抽出実行
        const timestampsData = await transcriptionService.extractTimestamps(transcription, audioPath);
        return timestampsData;
    } catch (error) {
        console.error('タイムスタンプ抽出中にエラーが発生しました:', error);
        return { timestamps: [] }; // エラー時は空のタイムスタンプ配列を返す
    }
}
/**
 * ジョブを処理する関数
 */
async function processJob() {
    let job = null;
    try {
        // キューからジョブを取得
        job = await (0, queue_1.getJob)(QUEUE_NAME);
        if (!job) {
            // ジョブがなければ待機して終了
            console.log('No jobs in queue. Waiting...');
            return;
        }
        console.log(`Processing transcription job ${job.id} for record ${job.recordId}`);
        // 処理状態の更新
        await prisma.record.update({
            where: { id: job.recordId },
            data: {
                status: 'PROCESSING',
                processing_step: 'TRANSCRIPTION'
            }
        });
        // R2からファイルを取得
        console.log(`Downloading file with key: ${job.fileKey}`);
        const fileData = await (0, storage_1.getFileContents)(job.fileKey);
        // 一時ファイルに保存
        const tempFilePath = path.join(TMP_DIR, `${Date.now()}-${job.id}.mp4`);
        fs.writeFileSync(tempFilePath, fileData);
        // 大きなファイルの場合は分割処理
        console.log(`Starting transcription process for file: ${tempFilePath}`);
        const transcriptParts = await processLargeFile(tempFilePath);
        // 結果をデータベースに保存
        const fullTranscript = transcriptParts.join('\n\n');
        
        // 文字起こし完了を記録
        await prisma.record.update({
            where: { id: job.recordId },
            data: {
                transcript_text: fullTranscript,
                status: 'PROCESSING',
                processing_step: 'TIMESTAMPS'
            }
        });
        
        // タイムスタンプ抽出処理
        console.log(`Extracting timestamps for record ${job.recordId}`);
        const timestampsData = await extractTimestamps(fullTranscript, tempFilePath);
        
        // タイムスタンプをJSONとして保存
        await prisma.record.update({
            where: { id: job.recordId },
            data: {
                timestamps_json: JSON.stringify(timestampsData),
                status: 'TRANSCRIBED',
                processing_step: null
            }
        });
        
        // 要約キューにジョブを追加
        await (0, queue_1.addJob)(SUMMARY_QUEUE, {
            type: 'summary',
            recordId: job.recordId,
            fileKey: job.fileKey
        });
        // 一時ファイルの削除
        fs.unlinkSync(tempFilePath);
        // ジョブを完了としてマーク
        await (0, queue_1.completeJob)(QUEUE_NAME, job.id);
        console.log(`Transcription job ${job.id} completed successfully`);
    }
    catch (error) {
        console.error('Error processing transcription job:', error);
        // ジョブIDがある場合のみリトライを実行
        if (job === null || job === void 0 ? void 0 : job.id) {
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
                console.error('Failed to update record status:', dbError);
            }
        }
    }
}
/**
 * メインワーカー処理
 */
async function startWorker() {
    console.log('Transcription worker started');
    try {
        // 継続的にジョブを処理
        while (true) {
            await processJob();
            // 少し待機してからポーリング
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    catch (error) {
        console.error('Fatal error in worker:', error);
        process.exit(1);
    }
}
// ワーカー開始
startWorker().catch(error => {
    console.error('Failed to start worker:', error);
    process.exit(1);
});
