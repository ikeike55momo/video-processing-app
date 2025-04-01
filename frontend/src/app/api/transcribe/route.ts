import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    // セッションチェック
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    // リクエストボディを解析
    const body = await request.json();
    const { fileKey, fileName } = body;

    if (!fileKey || !fileName) {
      return NextResponse.json(
        { error: 'fileKeyとfileNameは必須です' },
        { status: 400 }
      );
    }

    // レコードを作成
    const record = await prisma.record.create({
      data: {
        status: 'PROCESSING', // 直接処理中に設定
      },
    });

    // バックエンドAPIに処理開始リクエストを送信
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://video-processing-api.onrender.com';
    const processResponse = await fetch(`${apiUrl}/api/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recordId: record.id,
        fileKey,
        fileName,
      }),
    });

    if (!processResponse.ok) {
      const errorText = await processResponse.text();
      throw new Error(`処理の開始に失敗しました: ${errorText}`);
    }

    const processResult = await processResponse.json();

    return NextResponse.json({
      message: '処理を開始しました',
      recordId: record.id,
      jobId: processResult.jobId || null,
    });
  } catch (error) {
    console.error('文字起こし処理開始エラー:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '不明なエラーが発生しました' },
      { status: 500 }
    );
  }
}
