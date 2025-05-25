import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { getJob, completeJob, failJob, addJob } from '../lib/queue';

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// キュー名の定義
const QUEUE_NAME = 'summary';
const ARTICLE_QUEUE = 'article';

/**
 * テキストの要約を行う
 * @param text 要約対象のテキスト
 * @returns 要約結果
 */
async function summarizeText(text: string): Promise<string> {
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

    console.log(`Processing summary job ${job.id} for record ${job.recordId}`);

    // 処理状態の更新
    await prisma.record.update({
      where: { id: job.recordId },
      data: { 
        status: 'PROCESSING',
        processing_step: 'SUMMARY'
      }
    });

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
    await addJob(ARTICLE_QUEUE, {
      type: 'article',
      recordId: job.recordId,
      fileKey: job.fileKey
    });
    
    // ジョブを完了としてマーク
    await completeJob(QUEUE_NAME, job.id);
    
    console.log(`Summary job ${job.id} completed successfully`);
  } catch (error) {
    console.error('Error processing summary job:', error);
    
    // ジョブIDがある場合のみリトライを実行
    if (job?.id) {
      await failJob(QUEUE_NAME, job.id);
      
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
        console.error('Failed to update record status:', dbError);
      }
    }
  }
}

/**
 * メインワーカー処理
 */
async function startWorker() {
  console.log('Summary worker started');
  
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
