import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { ProcessingPipeline } from '@/app/services/processing-pipeline';

// 処理を再開するAPI
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // セッションチェック
    const session = await getServerSession();
    if (!session || !session.user) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    const recordId = params.id;
    if (!recordId) {
      return NextResponse.json(
        { error: 'レコードIDが必要です' },
        { status: 400 }
      );
    }

    // リクエストボディからステップを取得
    const body = await req.json();
    const step = body.step || 1;

    // レコードの存在確認
    const record = await prisma.record.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      return NextResponse.json(
        { error: 'レコードが見つかりません' },
        { status: 404 }
      );
    }

    // 処理ステータスを更新
    await prisma.record.update({
      where: { id: recordId },
      data: {
        status: 'PROCESSING',
      },
    });

    // 処理パイプラインを初期化
    const pipeline = new ProcessingPipeline();
    
    // 非同期で処理を開始（バックグラウンドで実行）
    setTimeout(async () => {
      try {
        await pipeline.retryFromStep(recordId, step);
      } catch (error) {
        console.error(`[${recordId}] 再開処理エラー:`, error);
        // エラー時はステータスを更新
        await prisma.record.update({
          where: { id: recordId },
          data: {
            status: 'ERROR',
            error: error instanceof Error ? error.message : '不明なエラーが発生しました',
          },
        });
      }
    }, 100);

    // 更新したレコードを返す
    const updatedRecord = await prisma.record.findUnique({
      where: { id: recordId },
    });

    return NextResponse.json({ record: updatedRecord });
  } catch (error) {
    console.error('再開処理APIエラー:', error);
    return NextResponse.json(
      { error: '処理の再開中にエラーが発生しました' },
      { status: 500 }
    );
  }
}
