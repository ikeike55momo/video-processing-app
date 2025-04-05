import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { getJob, completeJob, failJob, addJob, JobData } from '../lib/queue';
import { getFileContents, getDownloadUrl } from '../lib/storage';
import { execSync } from 'child_process';
import axios from 'axios';

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// キュー名の定義
const QUEUE_NAME = 'transcription';
const SUMMARY_QUEUE = 'summary';

// 一時ファイルディレクトリ
const TMP_DIR = process.env.TMP_DIR || '/tmp';

// 最大ファイルサイズ（バイト単位）- 4MB
const MAX_DIRECT_PROCESS_SIZE = 4 * 1024 * 1024;

// チャンクの最大時間（秒）
const CHUNK_DURATION = 300; // 5分

/**
 * 音声ファイルをGemini APIに最適な形式に変換する
 * @param inputPath 入力ファイルパス
 * @returns 最適化された音声ファイルのパス
 */
async function optimizeAudioForGemini(inputPath: string): Promise<string> {
  const workDir = path.dirname(inputPath);
  const optimizedPath = path.join(workDir, 'optimized.wav');
  
  console.log(`音声ファイルを最適化: ${inputPath} -> ${optimizedPath}`);
  
  try {
    // FFmpegを使用して16kHz、モノラル、WAV形式に変換
    execSync(`ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${optimizedPath}" -y`, 
      { stdio: 'inherit' });
    
    return optimizedPath;
  } catch (error) {
    console.error('音声最適化エラー:', error);
    throw new Error(`音声ファイルの最適化に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 音声ファイルの文字起こしを行う
 * @param audioPath 音声ファイルパス
 * @returns 文字起こし結果
 */
async function transcribeAudio(audioPath: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  try {
    // 音声ファイルを最適化
    const optimizedAudioPath = await optimizeAudioForGemini(audioPath);
    
    // ファイルサイズを確認
    const stats = fs.statSync(optimizedAudioPath);
    console.log(`最適化された音声ファイルサイズ: ${stats.size} バイト`);
    
    if (stats.size > MAX_DIRECT_PROCESS_SIZE) {
      // 大きなファイルはチャンク処理
      console.log(`ファイルサイズが大きいため、チャンク処理を適用します: ${stats.size} バイト`);
      return await processAudioInChunks(optimizedAudioPath);
    } else {
      // 小さなファイルは直接処理
      console.log(`ファイルを直接処理します: ${stats.size} バイト`);
      return await transcribeWithGemini(optimizedAudioPath);
    }
  } catch (error) {
    console.error('文字起こしエラー:', error);
    throw new Error(`文字起こし処理に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Gemini APIを使用して音声ファイルの文字起こしを行う
 * @param audioPath 音声ファイルパス
 * @returns 文字起こし結果
 */
async function transcribeWithGemini(audioPath: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  try {
    // 音声ファイルをBase64エンコード
    const audioData = fs.readFileSync(audioPath);
    const base64Audio = audioData.toString('base64');
    
    console.log(`Gemini Flashで文字起こしを実行中...`);
    
    // Gemini APIリクエスト
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `あなたは高精度文字起こしの専門家です。このファイルは実際にユーザーがアップロードした音声または動画データです。
                音声の内容を正確に文字起こししてください。音声が聞き取れない場合は「[聞き取れません]」と記載してください。
                架空のセミナー内容を生成しないでください。実際に聞こえる内容のみを文字起こししてください。
                可能であれば、話者の区別や音声の特徴（間、笑い声、拍手など）も記録してください。
                日本語の音声の場合は日本語で、英語の音声の場合は英語で文字起こしを行ってください。
                音声が聞き取れない場合は、架空の内容を作成せず、正直に「[聞き取れません]」と記載してください。`
              },
              {
                inline_data: {
                  mime_type: 'audio/wav',
                  data: base64Audio
                }
              }
            ]
          }
        ],
        generation_config: {
          temperature: 0.2,
          top_p: 0.95,
          top_k: 0,
          max_output_tokens: 8192,
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        }
      }
    );
    
    // レスポンスから文字起こし結果を抽出
    const transcription = response.data.candidates[0].content.parts[0].text;
    
    // 架空のセミナー内容が含まれていないか確認
    if (transcription.includes('架空のセミナー内容') || 
        transcription.includes('実際の音声ファイルがない') || 
        transcription.includes('音声ファイルが提供されていない')) {
      throw new Error('Gemini APIが架空の内容を生成しました。文字起こし結果は信頼できません。');
    }
    
    return transcription;
  } catch (error) {
    console.error('Gemini API文字起こしエラー:', error);
    throw new Error(`Gemini APIでの文字起こしに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 音声ファイルをチャンクに分割して処理する
 * @param audioPath 音声ファイルパス
 * @returns 結合された文字起こし結果
 */
async function processAudioInChunks(audioPath: string): Promise<string> {
  const workDir = path.dirname(audioPath);
  const chunkDir = path.join(workDir, 'chunks');
  
  // チャンクディレクトリを作成
  fs.mkdirSync(chunkDir, { recursive: true });
  
  try {
    // 音声ファイルの長さを取得（秒）
    const durationOutput = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`).toString().trim();
    const duration = parseFloat(durationOutput);
    
    console.log(`音声ファイルの長さ: ${duration}秒`);
    
    // チャンク数を計算
    const numChunks = Math.ceil(duration / CHUNK_DURATION);
    console.log(`${numChunks}個のチャンクに分割します（各${CHUNK_DURATION}秒）`);
    
    const transcriptionParts: string[] = [];
    
    // 各チャンクを処理
    for (let i = 0; i < numChunks; i++) {
      const startTime = i * CHUNK_DURATION;
      const chunkPath = path.join(chunkDir, `chunk_${i}.wav`);
      
      // チャンクを抽出
      console.log(`チャンク ${i+1}/${numChunks} を抽出中: ${startTime}秒から ${CHUNK_DURATION}秒間`);
      execSync(`ffmpeg -i "${audioPath}" -ss ${startTime} -t ${CHUNK_DURATION} -c copy "${chunkPath}" -y`, 
        { stdio: 'inherit' });
      
      // チャンクを文字起こし
      console.log(`チャンク ${i+1}/${numChunks} を文字起こし中...`);
      const chunkTranscription = await transcribeWithGemini(chunkPath);
      transcriptionParts.push(chunkTranscription);
      
      // 処理済みのチャンクを削除
      fs.unlinkSync(chunkPath);
    }
    
    // すべてのチャンクの結果を結合
    return transcriptionParts.join('\n\n');
  } catch (error) {
    console.error('チャンク処理エラー:', error);
    throw new Error(`音声ファイルのチャンク処理に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // チャンクディレクトリを削除
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('チャンクディレクトリの削除に失敗:', cleanupError);
    }
  }
}

/**
 * 大きなファイルを複数の小さなチャンクに分割して処理する
 * @param filePath ファイルパス
 * @returns 処理結果の配列
 */
async function processLargeFile(filePath: string): Promise<string[]> {
  // 処理開始時のメモリ使用量をログ出力
  console.log('ファイル処理開始時のメモリ使用量:');
  logMemoryUsage();
  
  // ファイル情報を取得
  const fileStats = fs.statSync(filePath);
  console.log(`ファイル情報: 存在=${fs.existsSync(filePath)}, サイズ=${fileStats.size} バイト`);
  
  // 一時ディレクトリの作成
  const workDir = path.join(TMP_DIR, `transcription-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });
  
  try {
    // 動画ファイルから音声を抽出
    const audioPath = path.join(workDir, 'audio.mp3');
    console.log(`動画ファイルから音声を抽出: ${filePath} -> ${audioPath}`);
    
    // FFmpegを使用して音声抽出
    execSync(`ffmpeg -i "${filePath}" -q:a 0 -map a "${audioPath}" -y`, { stdio: 'inherit' });
    
    // 音声抽出後のメモリ使用量をログ出力
    console.log('音声抽出後のメモリ使用量:');
    logMemoryUsage();
    
    // 音声ファイルを文字起こし（最適化と必要に応じたチャンク処理を含む）
    const transcription = await transcribeAudio(audioPath);
    
    // 文字起こし後のメモリ使用量をログ出力
    console.log('文字起こし完了後のメモリ使用量:');
    logMemoryUsage();
    
    // 一時ファイルの削除
    fs.unlinkSync(audioPath);
    
    return [transcription];
  } catch (error) {
    console.error('ファイル処理エラー:', error);
    throw error;
  } finally {
    // 一時ディレクトリの削除
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('一時ディレクトリの削除に失敗:', cleanupError);
    }
    
    // 処理完了時のメモリ使用量をログ出力
    console.log('メモリ使用量（処理完了時）:');
    logMemoryUsage();
  }
}

/**
 * ジョブを処理する関数
 */
async function processJob() {
  let job = null;
  
  try {
    // キューからジョブを取得
    job = await getJob(QUEUE_NAME);
    if (!job) {
      // ジョブがなければ待機して終了
      console.log('キューにジョブがありません。待機中...');
      return;
    }

    console.log(`文字起こしジョブ ${job.id} を処理中（レコードID: ${job.recordId}）`);

    // 処理状態の更新
    await prisma.record.update({
      where: { id: job.recordId },
      data: { 
        status: 'PROCESSING' as any,
      }
    });

    // R2からファイルを取得
    console.log(`ファイルをダウンロード中（キー: ${job.fileKey}）`);
    let fileData;
    let tempFilePath;
    
    // 一時ディレクトリを作成
    const tempDir = path.join(TMP_DIR, `transcription-${crypto.randomBytes(6).toString('hex')}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    try {
      // レコード情報を取得
      const record = await prisma.record.findUnique({
        where: { id: job.recordId }
      });
      
      if (!record) {
        throw new Error(`レコードが見つかりません: ${job.recordId}`);
      }
      
      console.log(`レコード情報: file_key=${record.file_key || 'なし'}, file_url=${record.file_url || 'なし'}`);
      
      // ファイルキーまたはURLを決定
      const fileKey = job.fileKey || record.file_key;
      const fileUrl = record.file_url;
      
      if (!fileKey && !fileUrl) {
        throw new Error('ファイルキーとURLの両方が見つかりません');
      }
      
      // まずR2からファイルの取得を試みる
      if (fileKey) {
        try {
          console.log(`R2からファイルを取得します: ${fileKey}`);
          fileData = await getFileContents(fileKey);
          
          // ファイル名を決定
          let fileName = fileKey.split('/').pop() || `${Date.now()}.mp4`;
          
          // 一時ファイルに保存
          tempFilePath = path.join(tempDir, fileName);
          fs.writeFileSync(tempFilePath, fileData);
          console.log(`R2からファイルをダウンロードしました: ${tempFilePath}`);
        } catch (r2Error) {
          console.error(`R2からのダウンロードに失敗しました: ${r2Error}`);
          // エラーを記録するが、次の方法を試みる
        }
      }
      
      // R2からの取得に失敗した場合、公開URLを試みる
      if (!tempFilePath && fileUrl) {
        try {
          // URLからファイル名を抽出
          const urlParts = new URL(fileUrl);
          const pathParts = urlParts.pathname.split('/');
          const fileName = pathParts[pathParts.length - 1] || `${Date.now()}.mp4`;
          
          console.log(`抽出したファイル名: ${fileName}`);
          
          // 公開URLを使用してファイルにアクセス
          console.log(`公開URLを使用してファイルにアクセスします: ${fileUrl}`);
          const response = await axios.get(fileUrl, { 
            responseType: 'arraybuffer',
            timeout: 60000 // 60秒タイムアウト
          });
          
          // 一時ファイルに保存
          tempFilePath = path.join(tempDir, fileName);
          fs.writeFileSync(tempFilePath, Buffer.from(response.data));
          console.log(`公開URLからのダウンロード完了: ${tempFilePath}`);
          
          // ファイルサイズを確認
          const fileStats = fs.statSync(tempFilePath);
          console.log(`ファイル情報: 存在=${fs.existsSync(tempFilePath)}, サイズ=${fileStats.size} バイト (${Math.round(fileStats.size / (1024 * 1024))} MB)`);
        } catch (urlError: any) {
          console.error(`公開URLからのダウンロードに失敗しました: ${urlError}`);
          throw new Error(`ファイルのダウンロードに失敗しました: ${urlError.message}`);
        }
      }
      
      // ファイルが取得できなかった場合
      if (!tempFilePath) {
        throw new Error('すべてのダウンロード方法が失敗しました');
      }
    } catch (downloadError) {
      console.error(`ファイルダウンロードエラー: ${downloadError}`);
      
      // 一時ディレクトリを削除
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('一時ディレクトリの削除に失敗:', cleanupError);
      }
      
      throw new Error(`ファイルのダウンロードに失敗しました: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`);
    }
    
    // 処理進捗状況を更新
    await prisma.record.update({
      where: { id: job.recordId },
      data: { 
        processing_step: 'TRANSCRIPTION',
        processing_progress: 10
      }
    });
    
    // ファイル処理（音声抽出、最適化、チャンク処理を含む）
    console.log(`文字起こし処理を開始: ${tempFilePath}`);
    const transcriptParts = await processLargeFile(tempFilePath);
    
    // 処理進捗状況を更新
    await prisma.record.update({
      where: { id: job.recordId },
      data: { 
        processing_progress: 80
      }
    });
    
    // 結果をデータベースに保存
    const fullTranscript = transcriptParts.join('\n\n');
    
    try {
      await prisma.record.update({
        where: { id: job.recordId },
        data: { 
          transcript_text: fullTranscript,
          status: 'TRANSCRIBED' as any, // TODO: Status.TRANSCRIBEDを使用するように修正
          processing_progress: 100
        } as any
      });
      
      console.log(`[${job.recordId}] 文字起こし結果をデータベースに保存しました`);
    } catch (dbError: any) {
      console.error(`[${job.recordId}] データベース更新エラー:`, dbError);
      throw new Error(`データベース更新に失敗しました: ${dbError.message}`);
    }
    
    // 要約キューにジョブを追加
    await addJob(SUMMARY_QUEUE, {
      type: 'summary',
      recordId: job.recordId,
      fileKey: job.fileKey
    });
    
    // 一時ファイルの削除
    fs.unlinkSync(tempFilePath);
    
    // ジョブを完了としてマーク
    await completeJob(QUEUE_NAME, job.id);
    
    console.log(`文字起こしジョブ ${job.id} が正常に完了しました`);
  } catch (error) {
    console.error('文字起こしジョブ処理エラー:', error);
    
    // ジョブIDがある場合のみリトライを実行
    if (job?.id) {
      await failJob(QUEUE_NAME, job.id);
      
      // エラーステータスを記録
      try {
        await prisma.record.update({
          where: { id: job.recordId },
          data: { 
            status: 'ERROR' as any, // TODO: Status.ERRORを使用するように修正
            error: error instanceof Error ? error.message : String(error),
          } as any
        });
      } catch (dbError: any) {
        console.error('レコードステータスの更新に失敗:', dbError);
      }
    }
  }
}

/**
 * メモリ使用量をログ出力する関数
 */
function logMemoryUsage() {
  const memoryUsage = process.memoryUsage();
  const rss = Math.round(memoryUsage.rss / 1024 / 1024);
  const heapTotal = Math.round(memoryUsage.heapTotal / 1024 / 1024);
  const heapUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  
  console.log(`メモリ使用量: RSS=${rss}MB Heap=${heapUsed}/${heapTotal}MB`);
  
  // メモリ使用量が高い場合は警告を出す
  if (rss > 3500) {
    console.warn(`⚠️ メモリ使用量が高くなっています: RSS=${rss}MB`);
    
    // ガベージコレクションを実行（--expose-gcフラグが必要）
    if (global.gc) {
      console.log('ガベージコレクションを実行します');
      global.gc();
      
      // GC後のメモリ使用量を再度ログ出力
      const afterGC = process.memoryUsage();
      console.log(`GC後のメモリ使用量: RSS=${Math.round(afterGC.rss / 1024 / 1024)}MB Heap=${Math.round(afterGC.heapUsed / 1024 / 1024)}/${Math.round(afterGC.heapTotal / 1024 / 1024)}MB`);
    }
  }
  
  return rss;
}

/**
 * メインワーカー処理
 */
async function startWorker() {
  console.log('文字起こしワーカーを開始しました');
  logMemoryUsage();
  
  try {
    // 継続的にジョブを処理
    while (true) {
      await processJob();
      
      // 定期的にメモリ使用量をログ出力
      logMemoryUsage();
      
      // 少し待機してからポーリング
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('ワーカーで致命的なエラーが発生:', error);
    process.exit(1);
  }
}

// ワーカー開始
startWorker().catch(error => {
  console.error('ワーカーの起動に失敗:', error);
  process.exit(1);
});
