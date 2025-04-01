import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

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

    console.log('transcribeエンドポイント: /api/processに転送します', { fileUrl, fileKey, fileName });

    // /api/processエンドポイントにリクエストを転送
    const processResponse = await fetch(new URL('/api/process', req.url).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileUrl }),
    });

    if (!processResponse.ok) {
      const errorText = await processResponse.text();
      console.error('/api/processエンドポイントからのエラー:', errorText);
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
    console.error('transcribeエンドポイントでエラーが発生しました:', error);
    return NextResponse.json(
      { error: '処理の開始に失敗しました' },
      { status: 500 }
    );
  }
}
