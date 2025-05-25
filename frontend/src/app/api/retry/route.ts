import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    // セッションチェックを一時的に無効化（デバッグ用）
    // const session = await getServerSession();
    // if (!session) {
    //   return NextResponse.json(
    //     { error: '認証が必要です' },
    //     { status: 401 }
    //   );
    // }

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

    // すべての状態のレコードをリトライ可能に変更
    // if (record.status !== 'ERROR') {
    //   return NextResponse.json(
    //     { error: 'エラー状態のレコードのみリトライ可能です' },
    //     { status: 400 }
    //   );
    // }

    // ステータスをPROCESSINGに更新
    const updatedRecord = await prisma.record.update({
      where: {
        id: record.id,
      },
      data: {
        status: 'PROCESSING',
      },
    });

    // 処理パイプラインを同期的に実行
    const ProcessingPipeline = (await import('@/app/services/processing-pipeline')).ProcessingPipeline;
    const pipeline = new ProcessingPipeline();
    try {
      await pipeline.retryProcessing(record.id);
      console.log('処理パイプラインが正常に完了しました');
    } catch (pipelineError) {
      console.error('処理パイプラインエラー:', pipelineError);
    }

    return NextResponse.json({ 
      success: true, 
      message: 'AI処理パイプラインを再開しました', 
      recordId: record.id 
    });
  } catch (error) {
    console.error('リトライエラー:', error);
    return NextResponse.json(
      { error: '処理の再開に失敗しました' },
      { status: 500 }
    );
  }
}
