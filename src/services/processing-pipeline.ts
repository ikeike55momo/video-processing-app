import { GeminiService } from './gemini-service';
import { ClaudeService } from './claude-service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// AI処理パイプラインを管理するクラス
export class ProcessingPipeline {
  private geminiService: GeminiService;
  private claudeService: ClaudeService;

  constructor() {
    this.geminiService = new GeminiService();
    this.claudeService = new ClaudeService();
  }

  // 処理パイプラインを実行
  async processVideo(recordId: string): Promise<void> {
    try {
      console.log(`[${recordId}] 処理パイプラインを開始します...`);
      
      // レコードの取得
      const record = await prisma.record.findUnique({
        where: { id: recordId }
      });
      
      if (!record) {
        throw new Error(`レコードが見つかりません: ${recordId}`);
      }
      
      // ステータスを処理中に更新
      await prisma.record.update({
        where: { id: recordId },
        data: { status: 'PROCESSING' }
      });
      
      console.log(`[${recordId}] ファイルURL: ${record.fileUrl}`);
      
      // 文字起こし処理
      console.log(`[${recordId}] 文字起こし処理を開始します...`);
      const transcription = await this.geminiService.transcribeAudio(record.fileUrl);
      
      // 文字起こし結果を保存
      await prisma.record.update({
        where: { id: recordId },
        data: {
          transcription,
          transcriptionStatus: 'COMPLETED'
        }
      });
      
      console.log(`[${recordId}] 文字起こし処理が完了しました`);
      
      // 要約処理
      console.log(`[${recordId}] 要約処理を開始します...`);
      const summary = await this.geminiService.generateSummary(transcription);
      
      // 要約結果を保存
      await prisma.record.update({
        where: { id: recordId },
        data: {
          summary,
          summaryStatus: 'COMPLETED'
        }
      });
      
      console.log(`[${recordId}] 要約処理が完了しました`);
      
      // 記事生成処理
      console.log(`[${recordId}] 記事生成処理を開始します...`);
      const article = await this.claudeService.generateArticle(summary);
      
      // 記事生成結果を保存
      await prisma.record.update({
        where: { id: recordId },
        data: {
          article,
          articleStatus: 'COMPLETED',
          status: 'COMPLETED'
        }
      });
      
      console.log(`[${recordId}] 記事生成処理が完了しました`);
      console.log(`[${recordId}] 処理パイプラインが完了しました`);
    } catch (error) {
      console.error(`[${recordId}] 処理中にエラーが発生しました:`, error);
      
      // エラー情報を保存
      try {
        await prisma.record.update({
          where: { id: recordId },
          data: {
            status: 'ERROR',
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        });
      } catch (dbError) {
        console.error(`[${recordId}] エラー情報の保存に失敗しました:`, dbError);
      }
      
      throw error;
    }
  }
}
