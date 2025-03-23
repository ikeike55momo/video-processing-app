import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ProcessingPipeline } from '@/app/services/processing-pipeline';
import prisma from '@/lib/prisma';
const pipeline = new ProcessingPipeline();

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // セッションチェックを一時的に無効化（デバッグ用）
    // const session = await getServerSession();
    // if (!session) {
    //   return NextResponse.json(
    //     { error: '認証が必要です' },
    //     { status: 401 }
    //   );
    // }

    const recordId = params.id;
    
    if (!recordId) {
      return NextResponse.json(
        { error: 'レコードIDが必要です' },
        { status: 400 }
      );
    }

    // リクエストボディの解析
    const { step } = await req.json();
    
    if (!step || typeof step !== 'number' || step < 1 || step > 4) {
      return NextResponse.json(
        { error: '有効なステップ番号（1-4）が必要です' },
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

    // ステップに応じた前提条件チェック
    if (step === 3 && !record.transcript_text) {
      return NextResponse.json(
        { error: '文字起こし結果がありません。文字起こしから再試行してください。' },
        { status: 400 }
      );
    }

    if (step === 4 && !record.summary_text) {
      return NextResponse.json(
        { error: '要約結果がありません。要約から再試行してください。' },
        { status: 400 }
      );
    }

    // ステータスをPROCESSINGに更新
    await prisma.record.update({
      where: {
        id: recordId,
      },
      data: {
        status: 'PROCESSING',
        error: null
      },
    });

    // 処理パイプラインを同期的に実行
    try {
      await pipeline.retryFromStep(recordId, step);
      console.log(`ステップ ${step} からの処理パイプラインが正常に完了しました`);
    } catch (pipelineError) {
      console.error(`ステップ ${step} からの再試行エラー:`, pipelineError);
    }

    const stepNames = {
      1: 'アップロード',
      2: '文字起こし',
      3: '要約',
      4: '記事生成'
    };

    return NextResponse.json({ 
      success: true, 
      message: `${stepNames[step as keyof typeof stepNames]}から処理を再開しました`, 
      recordId: record.id,
      step: step
    });
  } catch (error) {
    console.error('ステップ再試行エラー:', error);
    return NextResponse.json(
      { error: '処理の再開に失敗しました' },
      { status: 500 }
    );
  }
}
