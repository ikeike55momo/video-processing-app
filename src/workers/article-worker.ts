/**
 * 記事生成ワーカー
 * BullMQを使用して非同期で記事生成処理を実行します
 */
import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { queueManager, QUEUE_NAMES } from '../lib/bull-queue';
import * as dotenv from 'dotenv';
import axios from 'axios';

// 環境変数の読み込み
dotenv.config();

// Redisの接続URL
const redisUrl = process.env.REDIS_URL;

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// OpenRouter APIの設定
const openRouterApiKey = process.env.OPENROUTER_API_KEY;
if (!openRouterApiKey) {
  throw new Error('OPENROUTER_API_KEY環境変数が設定されていません');
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-opus';

/**
 * 記事生成ジョブの処理関数
 * @param job 記事生成ジョブ
 */
async function processArticleJob(job: Job): Promise<any> {
  try {
    const { recordId } = job.data;
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 5, '処理開始', '記事生成処理を開始しています');
    
    // レコードの存在確認
    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });
    
    if (!record) {
      throw new Error(`レコードが見つかりません: ${recordId}`);
    }
    
    if (!record.summary_text) {
      throw new Error('要約データがありません');
    }
    
    // ステータスを更新
    await prisma.record.update({
      where: { id: recordId },
      data: { status: 'PROCESSING' }
    });
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 20, '処理中', '要約データを分析しています');
    
    // メモリ使用量を監視
    const memUsage = process.memoryUsage();
    console.log(`メモリ使用量: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
    
    // 要約テキストを取得
    const summaryText = record.summary_text;
    const transcriptionText = record.transcript_text || '';
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 40, '処理中', '記事を生成しています');
    
    // OpenRouter APIを使用して記事を生成
    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: 'system',
            content: `あなたはプロのライターで、与えられた要約とトランスクリプションから魅力的な記事を作成します。
            記事は読みやすく、情報価値が高く、SEOに最適化されている必要があります。
            元のコンテンツの意図を尊重し、架空の情報を追加しないでください。`
          },
          {
            role: 'user',
            content: `以下の要約と文字起こしから、詳細な記事を作成してください。
            
            ## 要約
            ${summaryText}
            
            ## 文字起こし（参考情報）
            ${transcriptionText.substring(0, 2000)}...
            
            ## 記事の要件
            1. 明確な見出し構造を持つこと（H1, H2, H3など）
            2. 導入部、本文、結論の構造を持つこと
            3. 読者の関心を引く書き出しにすること
            4. 要約の内容を拡張し、詳細な説明を追加すること
            5. Markdown形式で出力すること
            6. 記事の長さは約2000〜3000文字にすること
            7. SEOに最適化された構造にすること
            
            ## 出力形式
            Markdown形式で、見出しや強調などの書式を適切に使用してください。`
          }
        ],
        temperature: 0.7,
        max_tokens: 4000
      },
      {
        headers: {
          'Authorization': `Bearer ${openRouterApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const article = response.data.choices[0].message.content;
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 90, '処理中', '結果を保存しています');
    
    // 結果をデータベースに保存
    await prisma.record.update({
      where: { id: recordId },
      data: {
        article_text: article,
        status: 'DONE'
      }
    });
    
    // 進捗状況を更新
    await queueManager.updateJobProgress(job, 100, 'completed', '記事生成が完了しました');
    
    return {
      success: true,
      recordId,
      message: '記事生成が完了しました'
    };
  } catch (error) {
    console.error('記事生成処理エラー:', error);
    
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
  QUEUE_NAMES.ARTICLE,
  processArticleJob,
  {
    connection: redisUrl ? {
      url: redisUrl
    } : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    },
    concurrency: 1, // 同時実行数（APIコスト削減のため1に制限）
    limiter: {
      max: 2, // 最大2ジョブ
      duration: 1000 * 60 * 5 // 5分間
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

console.log(`記事生成ワーカーを起動しました (PID: ${process.pid})`);

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
