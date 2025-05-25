import { PrismaClient, Status } from '@prisma/client';

// Prismaクライアントの初期化
const prisma = new PrismaClient();

/**
 * 文字起こし処理のステータスを取得する
 * @param recordId レコードID
 * @param fileSize ファイルサイズ（バイト、オプション）
 * @returns ステータス情報
 */
export async function getTranscriptionStatus(recordId: string, fileSize: number | null = null): Promise<any> {
  try {
    // レコードの取得
    const record = await prisma.record.findUnique({
      where: { id: recordId }
    });
    
    if (!record) {
      throw new Error('Record not found');
    }
    
    // ステータスに基づいて進捗情報を生成
    let progress = 0;
    let estimatedTimeRemaining = null;
    let status = record.status;
    
    switch (status) {
      case Status.UPLOADED:
        progress = 0;
        break;
      case Status.PROCESSING:
        // 処理ステップに基づいて進捗を推定
        switch (record.processing_step) {
          case 'TRANSCRIPTION':
            progress = 25;
            break;
          case 'SUMMARY':
            progress = 50;
            break;
          case 'ARTICLE':
            progress = 75;
            break;
          default:
            progress = 10;
        }
        
        // ファイルサイズに基づいて残り時間を推定（単純な例）
        if (fileSize) {
          // 1MBあたり10秒と仮定
          const estimatedTotalSeconds = (fileSize / (1024 * 1024)) * 10;
          const remainingSeconds = estimatedTotalSeconds * (1 - progress / 100);
          estimatedTimeRemaining = Math.max(1, Math.round(remainingSeconds));
        }
        break;
      case Status.TRANSCRIBED:
        progress = 40;
        break;
      case Status.SUMMARIZED:
        progress = 70;
        break;
      case Status.DONE:
        progress = 100;
        break;
      case Status.ERROR:
        // エラー状態の場合は最後の処理ステップに基づいて進捗を設定
        switch (record.processing_step) {
          case 'TRANSCRIPTION':
            progress = 20;
            break;
          case 'SUMMARY':
            progress = 45;
            break;
          case 'ARTICLE':
            progress = 70;
            break;
          default:
            progress = 10;
        }
        break;
      default:
        progress = 0;
    }
    
    return {
      recordId,
      status,
      progress,
      processingStep: record.processing_step,
      estimatedTimeRemaining,
      error: record.error,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error getting transcription status for record ${recordId}:`, error);
    throw error;
  }
}
