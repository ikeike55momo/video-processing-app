import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

/**
 * 文字起こし処理開始API
 * アップロードされたファイルの処理を開始します
 */
export async function POST(req: NextRequest) {
  try {
    // セッションチェック
    const session = await getServerSession();
    if (!session && process.env.NODE_ENV !== 'development') {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    // リクエストボディの解析
    const body = await req.json();
    const { fileKey, fileName } = body;
    
    if (!fileKey) {
      return NextResponse.json(
        { error: 'ファイルキーが必要です' },
        { status: 400 }
      );
    }

    // R2のパブリックURLを構築
    const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
    const fileUrl = `${R2_PUBLIC_URL}/${fileKey}`;

    // /api/processエンドポイントに転送
    const processUrl = `${req.nextUrl.origin}/api/process`;
    const processResponse = await fetch(processUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileUrl }),
    });

    if (!processResponse.ok) {
      const errorText = await processResponse.text();
      return NextResponse.json(
        { error: '処理の開始に失敗しました' },
        { status: processResponse.status }
      );
    }

    const result = await processResponse.json();
    
    return NextResponse.json({
      success: true,
      message: 'AI処理パイプラインを開始しました',
      recordId: result.recordId,
      jobId: result.recordId // 互換性のためにrecordIdをjobIdとしても返す
    });
  } catch (error) {
    console.error('transcribeエンドポイント: エラー', error);
    return NextResponse.json(
      { error: '処理の開始に失敗しました' },
      { status: 500 }
    );
  }
}
