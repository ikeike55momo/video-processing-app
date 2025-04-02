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
const axios = require("axios").default;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
// TranscriptionServiceを先頭でインポート
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
        
        // URLが正しく生成されたか確認
        if (!uploadData || !uploadData.url) {
            console.error('署名付きURLの生成に失敗しました:', uploadData);
            return res.status(500).json({
                error: '署名付きURLの生成に失敗しました'
            });
        }
        
        // デバッグ情報
        console.log('生成された署名付きURL:', uploadData.url.substring(0, 100) + '...');
        
        // 新しいレコードをデータベースに作成
        const record = yield prisma.record.create({
            data: {
                file_key: uploadData.key,
                r2_bucket: uploadData.bucket,
                file_url: uploadData.url, // file_urlフィールドを追加
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
        console.log('Process API received request body:', req.body);
        
        // リクエストボディからrecordId、fileKey、またはfileUrlを取得
        const { recordId, fileKey, fileUrl, fileName } = req.body;
        
        // recordIdが存在する場合はそれを使用
        if (recordId) {
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
        // fileKeyが存在する場合はそれを使用
        else if (fileKey) {
            // fileKeyからレコードを検索
            const record = yield prisma.record.findFirst({
                where: { file_url: fileUrl }
            });
            
            if (!record) {
                return res.status(404).json({ error: 'Record not found with the provided fileKey' });
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
                recordId: record.id,
                fileKey: record.file_key
            });
            
            // ステータスを更新
            yield prisma.record.update({
                where: { id: record.id },
                data: { status: 'PROCESSING' }
            });
            
            res.status(200).json({
                message: 'Processing started',
                recordId: record.id
            });
        }
        // fileUrlが存在する場合はそれを使用
        else if (fileUrl) {
            // fileUrlからfileKeyを抽出
            // 例: https://...r2.cloudflarestorage.com/uploads/1743352679651-30大プレゼント.mp4?...
            const urlPath = new URL(fileUrl).pathname; // /uploads/1743352679651-30大プレゼント.mp4
            const extractedFileKey = urlPath.startsWith('/') ? urlPath.substring(1) : urlPath;
            
            console.log('Extracted fileKey from fileUrl:', extractedFileKey);
            
            // fileKeyからレコードを検索
            const record = yield prisma.record.findFirst({
                where: { file_url: fileUrl }
            });
            
            if (!record) {
                return res.status(404).json({ error: 'Record not found with the extracted fileKey' });
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
                recordId: record.id,
                fileKey: record.file_key
            });
            
            // ステータスを更新
            yield prisma.record.update({
                where: { id: record.id },
                data: { status: 'PROCESSING' }
            });
            
            res.status(200).json({
                message: 'Processing started',
                recordId: record.id
            });
        }
        // どれも存在しない場合はエラー
        else {
            console.log('recordId, fileKey, or fileUrl is missing in the request body');
            return res.status(400).json({ error: 'recordId, fileKey, or fileUrl is required' });
        }
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
app.post('/api/transcribe', async (req, res) => {
  try {
    // リクエストボディからファイルURLとレコードIDを取得
    const { fileUrl, recordId } = req.body;
    
    if (!fileUrl) {
      return res.status(400).json({ error: 'ファイルURLが指定されていません' });
    }
    
    console.log(`文字起こしリクエスト受信: ${fileUrl}`);
    
    // レコードIDが指定されていない場合は新しいレコードを作成
    let record;
    if (!recordId) {
      record = await prisma.record.create({
        data: {
          file_url: fileUrl,
          status: 'PROCESSING',
          processing_step: 'TRANSCRIPTION'
        }
      });
      console.log(`新しいレコードを作成しました: ${record.id}`);
    } else {
      record = await prisma.record.findUnique({
        where: { id: recordId }
      });
      
      if (!record) {
        return res.status(404).json({ error: 'レコードが見つかりません' });
      }
      
      // ステータスを更新
      record = await prisma.record.update({
        where: { id: recordId },
        data: {
          status: 'PROCESSING',
          processing_step: 'TRANSCRIPTION'
        }
      });
    }
    
    // TranscriptionServiceが初期化されていない場合は初期化
    if (!transcriptionService) {
      console.log('TranscriptionServiceを初期化します');
      try {
        const transcriptionServicePath = path.join(__dirname, 'services', 'transcription-service.js');
        console.log(`TranscriptionServiceのパス: ${transcriptionServicePath}`);
        const { TranscriptionService } = require(transcriptionServicePath);
        transcriptionService = new TranscriptionService();
      } catch (error) {
        console.error('TranscriptionServiceの初期化に失敗しました:', error);
        return res.status(500).json({ error: `TranscriptionServiceの初期化に失敗しました: ${error.message}` });
      }
    }
    // 一時ディレクトリを作成
    const tempDir = path.join(os.tmpdir(), 'transcription-' + crypto.randomBytes(6).toString('hex'));
    fs.mkdirSync(tempDir, { recursive: true });
    
    // ファイルをダウンロード
    const filePath = await downloadFile(fileUrl, tempDir);
    console.log(`ファイルをダウンロードしました: ${filePath}`);
    
    // 文字起こし処理
    const transcript = await transcriptionService.transcribeAudio(filePath);
    
    // タイムスタンプ抽出処理
    console.log(`タイムスタンプ抽出処理を開始します`);
    const timestampsData = await transcriptionService.extractTimestamps(transcript, filePath);
    
    // 一時ディレクトリを削除
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`一時ディレクトリを削除しました: ${tempDir}`);
    } catch (err) {
      console.error(`一時ディレクトリの削除に失敗しました: ${tempDir}`, err);
    }
    
    // 文字起こし結果とタイムスタンプをデータベースに保存
    await prisma.record.update({
      where: { id: record.id },
      data: {
        transcript_text: transcript,
        timestamps_json: JSON.stringify(timestampsData),
        status: 'TRANSCRIBED',
        processing_step: null
      }
    });
    
    // 要約キューにジョブを追加
    await (0, queue_1.addJob)('summary', {
      type: 'summary',
      recordId: record.id,
      fileKey: record.file_key || path.basename(fileUrl)
    });
    
    console.log(`文字起こし処理が完了し、要約処理をキューに追加しました: ${record.id}`);
    
    return res.json({ 
      transcript, 
      recordId: record.id,
      jobId: record.id // ジョブIDとしてレコードIDを返す
    });
  } catch (error) {
    console.error('文字起こし処理エラー:', error);
    return res.status(500).json({ error: `文字起こし処理に失敗しました: ${error.message}` });
  }
});

/**
 * ファイルURLからファイルをダウンロード
 * @param {string} fileUrl ファイルのURL
 * @param {string} tempDir 一時ディレクトリのパス
 * @returns {Promise<string>} ダウンロードしたファイルのパス
 */
async function downloadFile(fileUrl, tempDir) {
  try {
    // R2の設定情報をログ出力
    console.log('R2設定情報:', {
      endpoint: process.env.R2_ENDPOINT ? '設定あり' : '未設定',
      accessKeyId: process.env.R2_ACCESS_KEY_ID ? '設定あり' : '未設定',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ? '設定あり（長さ: ' + (process.env.R2_SECRET_ACCESS_KEY?.length || 0) + '）' : '未設定',
      bucketName: process.env.R2_BUCKET_NAME,
      publicUrl: process.env.R2_PUBLIC_URL,
    });

    // URLの形式に応じた処理
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      // ファイル名を取得
      const urlObj = new URL(fileUrl);
      const fileName = path.basename(urlObj.pathname);
      const localFilePath = path.join(tempDir, fileName);
      
      // R2の署名付きURLかどうかを判断
      const isR2Url = fileUrl.includes('r2.cloudflarestorage.com') || 
                      fileUrl.includes('r2.dev');
      
      if (isR2Url) {
        console.log('R2の署名付きURLからファイルをダウンロードします');
        
        try {
          // URLからfileKeyを抽出
          // 例: https://...r2.cloudflarestorage.com/uploads/1743352679651-30大プレゼント.mp4?...
          const pathname = urlObj.pathname;
          // パスの先頭の/を削除
          let fileKey = pathname.startsWith('/') ? pathname.substring(1) : pathname;
          
          // クエリパラメータを削除（?以降を削除）
          fileKey = fileKey.split('?')[0];
          
          // バケット名がパスに含まれている場合は削除
          const bucketName = process.env.R2_BUCKET_NAME;
          if (bucketName && fileKey.startsWith(bucketName + '/')) {
            fileKey = fileKey.substring(bucketName.length + 1);
          }
          
          console.log(`抽出したファイルキー: ${fileKey}`);
          
          // R2から直接ファイルを取得
          try {
            console.log(`getFileContents関数を呼び出します。fileKey: ${fileKey}`);
            const { getFileContents } = require('./lib/storage');
            const fileBuffer = await getFileContents(fileKey);
            console.log(`getFileContents関数が成功しました。ファイルサイズ: ${fileBuffer.length} bytes`);
            
            // ファイルを一時ディレクトリに保存
            fs.writeFileSync(localFilePath, fileBuffer);
            console.log(`ファイルをR2から直接ダウンロードしました: ${localFilePath}`);
            return localFilePath;
          } catch (getContentsError) {
            console.error(`getFileContents関数でエラーが発生しました:`, getContentsError);
            throw getContentsError;
          }
        } catch (r2Error) {
          console.error('R2からのダウンロードに失敗しました。公開URLを試みます:', r2Error);
          
          // R2の公開URLを使用してみる
          const publicUrl = process.env.R2_PUBLIC_URL;
          if (publicUrl) {
            try {
              // URLからfileKeyを抽出（再度）
              const pathname = urlObj.pathname;
              let fileKey = pathname.startsWith('/') ? pathname.substring(1) : pathname;
              fileKey = fileKey.split('?')[0];
              
              if (bucketName && fileKey.startsWith(bucketName + '/')) {
                fileKey = fileKey.substring(bucketName.length + 1);
              }
              
              const directUrl = `${publicUrl}/${fileKey}`;
              console.log(`公開URLを使用してファイルにアクセスします: ${directUrl}`);
              
              const response = await axios({
                method: 'get',
                url: directUrl,
                responseType: 'stream',
                timeout: 30000,
              });
              
              const writer = fs.createWriteStream(localFilePath);
              response.data.pipe(writer);
              
              await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
              });
              
              console.log(`公開URLからのダウンロード完了: ${localFilePath}`);
              return localFilePath;
            } catch (publicUrlError) {
              console.error('公開URLからのダウンロードに失敗しました:', publicUrlError);
              // 失敗した場合は次の方法を試す
            }
          }
        }
      }
      
      // 通常のHTTPリクエストでダウンロード
      console.log('通常のHTTPリクエストでファイルをダウンロードします');
      console.log(`ファイルをダウンロード中: ${localFilePath}`);
      
      // ファイルをダウンロード
      const response = await axios({
        method: 'get',
        url: fileUrl,
        responseType: 'stream',
        // タイムアウトを設定（30秒）
        timeout: 30000,
        // リトライ設定
        maxRedirects: 5,
        // カスタムヘッダー
        headers: {
          'User-Agent': 'VideoProcessingApp/1.0',
          'Accept': '*/*'
        }
      });
      
      const writer = fs.createWriteStream(localFilePath);
      response.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
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

// ファイルキーからレコードを取得するエンドポイント
app.post('/api/get-record', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { fileKey } = req.body;
        
        if (!fileKey) {
            return res.status(400).json({
                error: 'Missing required field',
                details: 'fileKey is required'
            });
        }
        
        console.log(`ファイルキー ${fileKey} からレコードを検索中...`);
        
        // ファイルキーからレコードを検索
        const record = yield prisma.record.findFirst({
            where: { file_url: fileUrl }
        });
        
        if (!record) {
            return res.status(404).json({
                error: 'Record not found',
                details: `No record found with file key: ${fileKey}`
            });
        }
        
        console.log(`レコードが見つかりました: ${record.id}`);
        
        res.status(200).json({
            recordId: record.id,
            status: record.status
        });
    }
    catch (error) {
        console.error('Error retrieving record by file key:', error);
        res.status(500).json({
            error: 'Error retrieving record',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}));

// レコード一覧取得エンドポイント
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
// クラウドアップロード処理エンドポイント
app.post('/api/process-cloud', async (req, res) => {
  try {
    const { fileUrl } = req.body;
    
    if (!fileUrl) {
      return res.status(400).json({ error: 'ファイルURLが指定されていません' });
    }
    
    console.log(`クラウドアップロード処理リクエスト受信: ${fileUrl}`);
    
    // 新しいレコードをデータベースに作成
    const record = await prisma.record.create({
      data: {
        file_url: fileUrl,
        status: 'UPLOADED'
      }
    });
    
    // 文字起こしキューにジョブを追加
    try {
      await (0, queue_1.addJob)('transcription', {
        type: 'transcription',
        recordId: record.id,
        fileUrl: fileUrl
      });
      console.log(`ジョブをキューに追加しました: ${record.id}`);
    } catch (queueError) {
      console.error('キューへのジョブ追加に失敗しました:', queueError);
      // エラーがあってもレスポンスは返す
    }
    
    res.status(200).json({
      message: 'Processing started',
      recordId: record.id
    });
  } catch (error) {
    console.error('Error processing cloud upload:', error);
    res.status(500).json({
      error: 'Error processing cloud upload',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
// サーバーを起動
app.listen(PORT, async () => {
  console.log(`サーバーが起動しました。ポート: ${PORT}`);
  try {
    // TranscriptionServiceのダイナミックインポート
    const transcriptionServicePath = path.join(__dirname, 'services', 'transcription-service.js');
    console.log(`TranscriptionServiceのパス: ${transcriptionServicePath}`);
    const { TranscriptionService } = require(transcriptionServicePath);
    transcriptionService = new TranscriptionService();
    console.log('TranscriptionService初期化完了');
  } catch (error) {
    console.error('TranscriptionServiceの初期化に失敗しました:', error);
  }
});

// モジュールとしてもエクスポート（他のファイルからインポートできるように）
module.exports = app;
