/**
 * 要約ワーカー
 * BullMQを使用して非同期で要約処理を実行します
 */
import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { queueManager, QUEUE_NAMES } from '../lib/bull-queue';
import * as dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 環境変数の読み込み
dotenv.config();

// Redisの接続URL
const redisUrl = process.env.REDIS_URL;

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// Gemini APIの初期化
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  throw new Error('GEMINI_API_KEY環境変数が設定されていません');
}
const genAI = new GoogleGenerativeAI(geminiApiKey);
const geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-pro';

/**
 * 要約ジョブの処理関数
 * @param job 要約ジョブ
 */
async function processSummaryJob(job: Job): Promise<any> {
  try {
    const { recordId } = job.data;
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 5, '処理開始', '要約処理を開始しています');
    
    // レコードの存在確認
    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });
    
    if (!record) {
      throw new Error(`レコードが見つかりません: ${recordId}`);
    }
    
    if (!record.transcript_text) {
      throw new Error('文字起こしデータがありません');
    }
    
    // ステータスを更新
    await prisma.record.update({
      where: { id: recordId },
      data: { status: 'PROCESSING' }
    });
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 20, '処理中', '文字起こしデータを分析しています');
    
    // メモリ使用量を監視
    const memUsage = process.memoryUsage();
    console.log(`メモリ使用量: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
    
    // 文字起こしテキストを取得
    const transcriptionText = String(record.transcript_text); // transcripitonTextを文字列型に変換
    
    if (!transcriptionText) {
      throw new Error('文字起こしデータが空です');
    }
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 40, '処理中', '要約を生成しています');
    
    // Gemini APIを使用して要約を生成
    const model = genAI.getGenerativeModel({ model: geminiModel });
    
    // プロンプトの作成
    const prompt = `
    あなたは高品質な要約の専門家です。以下の文字起こしテキストを要約してください。

    ## 要約の指示
    1. 重要なポイントを漏らさず、簡潔にまとめてください
    2. 話の流れや構造を保持してください
    3. 専門用語や固有名詞はそのまま使用してください
    4. 箇条書きではなく、段落形式で要約してください
    5. 要約は元のテキストの約20%の長さにしてください

    ## 文字起こしテキスト
    ${transcriptionText}

    ## 出力形式
    - 冒頭に「# 要約」というタイトルをつけてください
    - Markdown形式で出力してください
    - 要約の後に、重要なキーワードを5-10個リストアップしてください
    `;
    
    const result = await model.generateContent(prompt);
    const response = result.response;
    const summary = response.text();
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 70, '処理中', 'タイムスタンプを抽出しています');
    
    // タイムスタンプの抽出（正規表現で時間表記を検出）
    const timestampRegex = /(\d{1,2}):(\d{2}):(\d{2})|(\d{1,2}):(\d{2})/g;
    const timestampMatches = transcriptionText.match(timestampRegex) || [];
    
    // タイムスタンプとその周辺テキストを抽出
    const timestampContexts = [];
    let match;
    while ((match = timestampRegex.exec(transcriptionText)) !== null) {
      const timestamp = match[0];
      const startIndex = Math.max(0, match.index - 50);
      const endIndex = Math.min(transcriptionText.length, match.index + timestamp.length + 100);
      const context = transcriptionText.substring(startIndex, endIndex).trim();
      
      timestampContexts.push({
        timestamp,
        context
      });
    }
    
    // タイムスタンプJSONを作成
    const timestampsJson = JSON.stringify(timestampContexts);
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 90, '処理中', '結果を保存しています');
    
    // 結果をデータベースに保存
    await prisma.record.update({
      where: { id: recordId },
      data: {
        summary_text: summary,
        timestamps_json: timestampsJson,
        status: 'SUMMARIZED'
      }
    });
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 100, 'completed', '要約が完了しました');
    
    // 記事生成ジョブをキューに追加
    const articleJobId = await queueManager.addJob(QUEUE_NAMES.ARTICLE, {
      type: 'article',
      recordId,
      fileKey: record.file_key || ''
    });
    
    console.log(`記事生成ジョブをキューに追加しました: ${articleJobId}`);
    
    return {
      success: true,
      recordId,
      message: '要約が完了しました',
      nextJob: {
        type: 'article',
        jobId: articleJobId
      }
    };
  } catch (error) {
    console.error('要約処理エラー:', error);
    
    // エラー情報を記録
    try {
      await prisma.record.update({
        where: { id: job.data.recordId },
        data: {
          status: 'ERROR',
          error: error instanceof Error ? error.message : '不明なエラー'
        }
      });
    } catch (dbError) {
      console.error('エラー情報の記録に失敗しました:', dbError);
    }
    
    throw error;
  }
}

/**
 * メモリ使用量を監視する関数
 */
function monitorMemoryUsage(): void {
  const memUsage = process.memoryUsage();
  const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  console.log(`メモリ使用量: ${memUsageMB}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
  
  // メモリ使用量が閾値を超えた場合、GCを促進
  if (memUsageMB > 1024) { // 1GB以上
    if (global.gc) {
      console.log('ガベージコレクションを実行します');
      global.gc();
    } else {
      console.log('ガベージコレクションを実行できません。--expose-gc フラグを使用してください。');
    }
  }
}

// 定期的にメモリ使用量を監視
setInterval(monitorMemoryUsage, 60000); // 1分ごと

// ワーカーの初期化
const worker = new Worker(
  QUEUE_NAMES.SUMMARY,
  processSummaryJob,
  {
    connection: redisUrl ? {
      url: redisUrl
    } : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    },
    concurrency: 1, // 同時実行数を制限（リソース消費を抑える）
    limiter: {
      max: 2, // 最大2ジョブ
      duration: 1000 * 60 // 1分間
    }
  }
);

// ワーカーイベントリスナー
worker.on('completed', (job: Job) => {
  console.log(`ジョブ完了: ${job.id}`);
});

worker.on('failed', (job: Job | undefined, error: Error) => {
  console.error(`ジョブ失敗: ${job?.id}`, error);
});

worker.on('error', (error: Error) => {
  console.error('ワーカーエラー:', error);
});

console.log(`要約ワーカーを起動しました (PID: ${process.pid})`);

// プロセス終了時の処理
process.on('SIGTERM', async () => {
  console.log('SIGTERM受信、ワーカーを終了します');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT受信、ワーカーを終了します');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});
