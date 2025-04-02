import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// 処理を再開するAPI
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // セッションチェック
    const session = await getServerSession(authOptions);
    if (!session) {
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
        error: null // エラー情報をクリア
      },
    });

    // バックエンドAPIに処理再開リクエストを送信
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://video-processing-api.onrender.com';
    console.log(`バックエンドAPIに再開リクエストを送信: ${apiUrl}/api/records/${recordId}/retry`);
    
    const retryResponse = await fetch(`${apiUrl}/api/records/${recordId}/retry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        step: step
      }),
    });

    if (!retryResponse.ok) {
      const errorText = await retryResponse.text();
      console.error('バックエンドAPI再開処理エラー:', errorText);
      
      // エラー情報をデータベースに保存
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          status: 'ERROR',
          error: `処理の再開に失敗しました: ${errorText}`
        },
      });
      
      throw new Error(`処理の再開に失敗しました: ${errorText}`);
    }

    const retryResult = await retryResponse.json();
    console.log('バックエンドAPI再開処理結果:', retryResult);

    // 更新したレコードを返す
    const updatedRecord = await prisma.record.findUnique({
      where: { id: recordId },
    });

    return NextResponse.json({ 
      record: updatedRecord,
      message: '処理を再開しました',
      backend_result: retryResult
    });
  } catch (error) {
    console.error('再開処理APIエラー:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '処理の再開中にエラーが発生しました' },
      { status: 500 }
    );
  }
}
