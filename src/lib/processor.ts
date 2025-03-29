import { PrismaClient, Status } from '@prisma/client';
import { socketManager } from './socket-manager';

// Prismaクライアントの初期化
const prisma = new PrismaClient();

/**
 * レコードの処理を開始する
 * @param options 処理オプション
 * @returns ジョブ情報
 */
export async function processRecord(options: {
  recordId: string;
  fileKey?: string | null;
  fileUrl: string | null;
  bucket?: string | null;
  reset?: boolean;
}) {
  const { recordId, fileKey, fileUrl, bucket, reset } = options;
  
  // ジョブIDの生成（単純なランダムID）
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  
  // 非同期で処理を開始
  setTimeout(async () => {
    try {
      // 処理開始を通知
      socketManager.emitToRecord(recordId, 'processingStarted', {
        recordId,
        jobId,
        status: 'processing',
        message: '処理を開始しました'
      });
      
      // レコードのステータスを更新
      await prisma.record.update({
        where: { id: recordId },
        data: {
          status: Status.PROCESSING,
          processing_step: 'TRANSCRIPTION',
          error: null
        }
      });
      
      // 実際の処理はここに実装
      // この例では単にステータスを更新するだけ
      
      // 処理完了を通知
      socketManager.emitToRecord(recordId, 'processingCompleted', {
        recordId,
        jobId,
        status: 'completed',
        message: '処理が完了しました'
      });
      
    } catch (error) {
      console.error(`Processing error for record ${recordId}:`, error);
      
      // エラー情報を保存
      await prisma.record.update({
        where: { id: recordId },
        data: {
          status: Status.ERROR,
          error: error instanceof Error ? error.message : String(error)
        }
      });
      
      // エラーを通知
      socketManager.emitToRecord(recordId, 'processingError', {
        recordId,
        jobId,
        status: 'error',
        message: '処理中にエラーが発生しました',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }, 100);
  
  // ジョブ情報を返す
  return {
    id: jobId,
    recordId,
    status: 'queued'
  };
}
