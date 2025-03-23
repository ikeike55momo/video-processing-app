import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    // セッションチェック
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    // リクエストボディの解析
    const { recordId } = await req.json();
    
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

    // 処理パイプラインを非同期で実行（動的インポート）
    try {
      // サーバーサイドでのみ実行されるコード
      const { ProcessingPipeline } = await import('@/app/services/processing-pipeline');
      const pipeline = new ProcessingPipeline();
      
      // 非同期で処理を実行
      pipeline.processVideo(recordId).catch(error => {
        console.error('処理パイプラインエラー:', error);
      });
    } catch (error) {
      console.error('パイプラインのインポートエラー:', error);
      // エラーが発生してもレスポンスは返す（処理は非同期なので）
    }

    return NextResponse.json({ 
      success: true, 
      message: 'AI処理パイプラインを開始しました', 
      recordId: record.id 
    });
  } catch (error) {
    console.error('AI処理開始エラー:', error);
    return NextResponse.json(
      { error: 'AI処理の開始に失敗しました' },
      { status: 500 }
    );
  }
}
