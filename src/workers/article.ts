import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { getJob, completeJob, failJob } from '../lib/queue';

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// キュー名の定義
const QUEUE_NAME = 'article';

/**
 * 記事生成を行う
 * @param transcript 文字起こしテキスト
 * @param summary 要約テキスト
 * @returns 生成された記事テキスト
 */
async function generateArticle(transcript: string, summary: string): Promise<string> {
  // ここではOpenRouter（Claude）APIを使用する簡易的な実装
  // 実際の実装では適切なAPIクライアントを使用
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  // TODO: 実際のOpenRouter API呼び出し実装
  // この例では単純なモックを返しています
  console.log(`[MOCK] Generating article from transcript(${transcript.length} chars) and summary(${summary.length} chars)`);
  
  // モック応答（実際はAPIを使用）
  return `# 記事タイトル

## はじめに

${summary}

## 内容

これはデモの記事です。実際にはClaudeなどのAIを使用して文字起こしと要約から記事を生成します。

## まとめ

これはOpenRouterを使用した文章生成のデモです。`;
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

    console.log(`Processing article job ${job.id} for record ${job.recordId}`);

    // 処理状態の更新
    await prisma.record.update({
      where: { id: job.recordId },
      data: { 
        status: 'PROCESSING',
        processing_step: 'ARTICLE'
      }
    });

    // 文字起こしと要約結果を取得
    const record = await prisma.record.findUnique({
      where: { id: job.recordId },
      select: { 
        transcript_text: true,
        summary_text: true
      }
    });

    if (!record || !record.transcript_text || !record.summary_text) {
      throw new Error('Transcript or summary text not found');
    }

    // 記事生成処理
    console.log(`Starting article generation process for record ${job.recordId}`);
    const article = await generateArticle(record.transcript_text, record.summary_text);
    
    // 結果をデータベースに保存
    await prisma.record.update({
      where: { id: job.recordId },
      data: { 
        article_text: article,
        status: 'DONE',
        processing_step: null
      }
    });
    
    // ジョブを完了としてマーク
    await completeJob(QUEUE_NAME, job.id);
    
    console.log(`Article job ${job.id} completed successfully`);
  } catch (error) {
    console.error('Error processing article job:', error);
    
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
  console.log('Article worker started');
  
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
