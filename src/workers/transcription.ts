import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { getJob, completeJob, failJob, addJob } from '../lib/queue';
import { getFileContents, getDownloadUrl } from '../lib/storage';
import { execSync } from 'child_process';

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new PrismaClient();

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
async function transcribeAudio(audioPath: string): Promise<string> {
  // ここではGemini APIを使用する簡易的な実装
  // 実際の実装では適切なAPIクライアントを使用
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  // TODO: 実際のGemini API呼び出し実装
  // この例では単純なモックを返しています
  console.log(`[MOCK] Transcribing audio file: ${audioPath}`);
  
  // モック応答（実際はAPIを使用）
  return "これはデモの文字起こし結果です。実際にはGemini APIを使用して音声認識を行います。";
}

/**
 * 大きなファイルを複数の小さなチャンクに分割して処理する
 * @param filePath ファイルパス
 * @returns 処理結果の配列
 */
async function processLargeFile(filePath: string): Promise<string[]> {
  // 一時ディレクトリの作成
  const workDir = path.join(TMP_DIR, `transcription-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });
  
  try {
    // 動画ファイルから音声を抽出
    const audioPath = path.join(workDir, 'audio.mp3');
    console.log(`Extracting audio from ${filePath} to ${audioPath}`);
    
    // FFmpegを使用して音声抽出
    execSync(`ffmpeg -i "${filePath}" -q:a 0 -map a "${audioPath}" -y`, { stdio: 'inherit' });
    
    // 音声ファイルを分割（実際の実装ではファイルサイズに基づいて分割）
    // この例では簡易的に全体を処理
    const transcription = await transcribeAudio(audioPath);
    
    // 一時ファイルの削除
    fs.unlinkSync(audioPath);
    
    return [transcription];
  } catch (error) {
    console.error('Error processing file:', error);
    throw error;
  } finally {
    // 一時ディレクトリの削除
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('Error cleaning up temp directory:', cleanupError);
    }
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
      console.log('No jobs in queue. Waiting...');
      return;
    }

    console.log(`Processing transcription job ${job.id} for record ${job.recordId}`);

    // 処理状態の更新
    await prisma.record.update({
      where: { id: job.recordId },
      data: { 
        status: 'PROCESSING',
      }
    });

    // R2からファイルを取得
    console.log(`Downloading file with key: ${job.fileKey}`);
    const fileData = await getFileContents(job.fileKey);
    
    // 一時ファイルに保存
    const tempFilePath = path.join(TMP_DIR, `${Date.now()}-${job.id}.mp4`);
    fs.writeFileSync(tempFilePath, fileData);
    
    // 大きなファイルの場合は分割処理
    console.log(`Starting transcription process for file: ${tempFilePath}`);
    const transcriptParts = await processLargeFile(tempFilePath);
    
    // 結果をデータベースに保存
    const fullTranscript = transcriptParts.join('\n\n');
    
    try {
      await prisma.record.update({
        where: { id: job.recordId },
        data: { 
          transcript_text: fullTranscript,
          status: 'DONE' as any,
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
    
    console.log(`Transcription job ${job.id} completed successfully`);
  } catch (error) {
    console.error('Error processing transcription job:', error);
    
    // ジョブIDがある場合のみリトライを実行
    if (job?.id) {
      await failJob(QUEUE_NAME, job.id);
      
      // エラーステータスを記録
      try {
        await prisma.record.update({
          where: { id: job.recordId },
          data: { 
            status: 'ERROR',
            errorMessage: error instanceof Error ? error.message : String(error),
          } as any
        });
      } catch (dbError: any) {
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
  } catch (error) {
    console.error('Fatal error in worker:', error);
    process.exit(1);
  }
}

// ワーカー開始
startWorker().catch(error => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});
