import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

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

    // 処理パイプラインを非同期で実行（動的インポート）
    try {
      // サーバーサイドでのみ実行されるコード
      const { ProcessingPipeline } = await import('@/app/services/processing-pipeline');
      const pipeline = new ProcessingPipeline();
      
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

      // ステップに応じた処理を実行
      await pipeline.retryFromStep(recordId, step);
      console.log(`ステップ ${step} からの処理パイプラインが正常に完了しました`);

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
      console.error(`ステップ ${step} の処理エラー:`, error);
      return NextResponse.json(
        { error: `ステップ ${step} の処理に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('ステップ処理エラー:', error);
    return NextResponse.json(
      { error: '処理に失敗しました' },
      { status: 500 }
    );
  }
}
