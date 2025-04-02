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
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
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
    try {
        // ジョブの取得
        const job = await (0, queue_1.getJob)(QUEUE_NAME);
        if (!job) {
            console.log('No jobs in queue. Waiting...');
            return;
        }
        
        console.log(`Processing transcription job ${job.id} for record ${job.recordId}`);
        
        // 処理状態の更新
        try {
          await prisma.record.update({
            where: { id: job.recordId },
            data: { 
              status: 'PROCESSING',
              processing_step: 'TRANSCRIPTION'
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
        
        // ファイルの取得（fileKeyまたはfileUrlから）
        let fileData;
        let tempFilePath;
        let tempDir;
        
        try {
          if (job.fileKey) {
            // R2からファイルを取得
            console.log(`Downloading file with key: ${job.fileKey}`);
            try {
              console.log(`R2からファイルのダウンロードを開始します...`);
              fileData = await (0, storage_1.getFileContents)(job.fileKey);
              console.log(`R2からファイルのダウンロードが完了しました。サイズ: ${fileData.length} バイト`);
            } catch (downloadError) {
              console.error(`R2からのファイルダウンロードに失敗しました:`, downloadError);
              throw downloadError;
            }
          } else if (job.fileUrl) {
            // URLからファイルを取得
            console.log(`Downloading file from URL: ${job.fileUrl}`);
            // 一時ディレクトリを作成
            tempDir = path.join(os.tmpdir(), 'transcription-' + crypto.randomBytes(6).toString('hex'));
            fs.mkdirSync(tempDir, { recursive: true });
            
            // ファイルをダウンロード
            try {
              console.log(`URLからファイルのダウンロードを開始します...`);
              tempFilePath = await downloadFile(job.fileUrl, tempDir);
              const stats = fs.statSync(tempFilePath);
              console.log(`URLからファイルのダウンロードが完了しました。サイズ: ${stats.size} バイト, パス: ${tempFilePath}`);
              fileData = fs.readFileSync(tempFilePath);
            } catch (downloadError) {
              console.error(`URLからのファイルダウンロードに失敗しました:`, downloadError);
              throw downloadError;
            }
          } else {
            throw new Error('Neither fileKey nor fileUrl provided in job');
          }
          
          // 一時ファイルの作成
          if (!tempFilePath) {
            try {
              console.log(`一時ファイルの作成を開始します...`);
              tempDir = tempDir || os.tmpdir();
              tempFilePath = path.join(tempDir, `audio-${Date.now()}.mp3`);
              fs.writeFileSync(tempFilePath, fileData);
              const stats = fs.statSync(tempFilePath);
              console.log(`一時ファイルの作成が完了しました。サイズ: ${stats.size} バイト, パス: ${tempFilePath}`);
            } catch (tempFileError) {
              console.error(`一時ファイルの作成に失敗しました:`, tempFileError);
              throw tempFileError;
            }
          }
          
          // 音声ファイルの処理
          try {
            console.log(`音声ファイルの処理を開始します...`);
            console.log(`メモリ使用量: ${process.memoryUsage().heapUsed / 1024 / 1024} MB`);
            
            // ファイルサイズを確認
            const stats = fs.statSync(tempFilePath);
            const fileSizeMB = stats.size / (1024 * 1024);
            console.log(`ファイルサイズ: ${fileSizeMB.toFixed(2)} MB`);
            
            let transcriptionResult;
            
            // 大きなファイルの場合は分割処理
            if (fileSizeMB > 10) {
              console.log(`ファイルサイズが10MBを超えるため、分割処理を行います...`);
              transcriptionResult = await processLargeFile(tempFilePath);
            } else {
              console.log(`通常の処理を行います...`);
              transcriptionResult = await transcribeAudio(tempFilePath);
            }
            
            console.log(`音声ファイルの処理が完了しました。結果の長さ: ${transcriptionResult.length} 文字`);
            
            // 文字起こし結果が配列の場合は文字列に変換
            let transcriptText = transcriptionResult;
            if (Array.isArray(transcriptionResult)) {
              console.log(`文字起こし結果が配列形式です。配列の長さ: ${transcriptionResult.length}`);
              transcriptText = transcriptionResult.join(' ');
              console.log(`配列を文字列に変換しました。文字列の長さ: ${transcriptText.length}`);
            }
            
            // 文字起こし完了を記録
            await prisma.record.update({
              where: { id: job.recordId },
              data: {
                transcript_text: transcriptText,
                status: 'PROCESSING',
                processing_step: 'TIMESTAMPS'
              }
            });
            
            // タイムスタンプ抽出処理
            const timestampsData = await extractTimestamps(transcriptText, tempFilePath);
            
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
              fileKey: job.fileKey,
              fileUrl: job.fileUrl
            });
            
            // 一時ファイルの削除
            try {
              fs.unlinkSync(tempFilePath);
              if (tempDir && tempDir !== os.tmpdir()) {
                fs.rmdirSync(tempDir, { recursive: true });
              }
              console.log(`Temporary file deleted: ${tempFilePath}`);
            } catch (err) {
              console.error(`Failed to delete temporary file: ${tempFilePath}`, err);
            }
            
            // ジョブを完了としてマーク
            await (0, queue_1.completeJob)(QUEUE_NAME, job.id);
            console.log(`Transcription job ${job.id} completed successfully`);
          } catch (error) {
            console.error('Error processing transcription job:', error);
            
            // 一時ファイルの削除（エラー時も）
            if (tempFilePath) {
              try {
                fs.unlinkSync(tempFilePath);
                if (tempDir && tempDir !== os.tmpdir()) {
                  fs.rmdirSync(tempDir, { recursive: true });
                }
              } catch (err) {
                console.error(`Failed to delete temporary file: ${tempFilePath}`, err);
              }
            }
            
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
              } catch (dbError) {
                if (dbError.code === 'P2025') {
                  console.warn(`Record ${job.recordId} not found in database when updating error status.`);
                } else {
                  console.error('Failed to update record status:', dbError);
                }
              }
            }
            
            throw error;
          }
        } catch (error) {
          console.error('Fatal error in processJob:', error);
          // エラーをスローせずに処理を続行（startWorkerでキャッチされる）
        }
    }
    catch (error) {
        console.error('ジョブ処理中にエラーが発生しました:', error);
        // ジョブエラーでは終了せず、次のジョブを処理
    }
    // 少し待機してからポーリング
    await new Promise(resolve => setTimeout(resolve, 1000));
}

/**
 * ファイルURLからファイルをダウンロード
 * @param {string} fileUrl ファイルのURL
 * @param {string} tempDir 一時ディレクトリのパス
 * @returns {Promise<string>} ダウンロードしたファイルのパス
 */
async function downloadFile(fileUrl, tempDir) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(fileUrl);
    const fileName = path.basename(parsedUrl.pathname);
    const filePath = path.join(tempDir, fileName);
    const fileStream = fs.createWriteStream(filePath);
    
    console.log(`Downloading file from ${fileUrl} to ${filePath}`);
    
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const request = protocol.get(fileUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download file: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`File downloaded successfully to ${filePath}`);
        resolve(filePath);
      });
    });
    
    request.on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
    
    fileStream.on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

/**
 * メインワーカー処理
 */
async function startWorker() {
    try {
        console.log('========================================');
        console.log(`文字起こしワーカー起動: ${new Date().toISOString()}`);
        console.log(`Node環境: ${process.env.NODE_ENV}`);
        console.log(`ワーカータイプ: ${process.env.WORKER_TYPE || 'transcription'}`);
        
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
        
        console.log('文字起こしワーカーが正常に起動しました');
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
