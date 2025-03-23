import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // セッションチェック
    const session = await getServerSession();
    if (!session?.user || (session.user && 'role' in session.user && session.user.role !== 'ADMIN')) {
      return NextResponse.json(
        { error: '管理者権限が必要です' },
        { status: 403 }
      );
    }

    const recordId = params.id;
    
    if (!recordId) {
      return NextResponse.json(
        { error: 'レコードIDが必要です' },
        { status: 400 }
      );
    }

    // レコードの検索
    const record = await prisma.record.findUnique({
      where: {
        id: recordId,
      },
    });

    if (!record) {
      return NextResponse.json(
        { error: '指定されたレコードが見つかりません' },
        { status: 404 }
      );
    }

    // 処理パイプラインを非同期で再実行（動的インポート）
    try {
      // サーバーサイドでのみ実行されるコード
      const { ProcessingPipeline } = await import('@/app/services/processing-pipeline');
      const pipeline = new ProcessingPipeline();
      
      // 非同期で処理を実行
      pipeline.retryProcessing(recordId).catch(error => {
        console.error('処理再試行エラー:', error);
      });
    } catch (error) {
      console.error('パイプラインのインポートエラー:', error);
      // エラーが発生してもレスポンスは返す（処理は非同期なので）
    }

    return NextResponse.json({ 
      success: true, 
      message: '処理を再試行しました', 
      recordId: record.id 
    });
  } catch (error) {
    console.error('処理再試行エラー:', error);
    return NextResponse.json(
      { error: '処理の再試行に失敗しました' },
      { status: 500 }
    );
  }
}
