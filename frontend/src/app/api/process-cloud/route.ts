import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

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
    const { fileUrl, fileName } = await req.json();
    
    if (!fileUrl) {
      return NextResponse.json(
        { error: 'ファイルURLが必要です' },
        { status: 400 }
      );
    }

    // APIサーバーのURL
    const apiUrl = process.env.API_URL || 'https://video-processing-api.onrender.com';
    console.log('Cloud処理開始リクエスト:', { fileUrl, apiUrl });

    // 新しいレコードを作成
    const newRecord = await prisma.record.create({
      data: {
        file_url: fileUrl,
        status: 'PROCESSING',
      },
    });
    
    console.log('新しいレコードを作成しました:', newRecord);

    // バックエンドAPIに処理を依頼
    const response = await fetch(`${apiUrl}/api/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recordId: newRecord.id,
        fileUrl,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API呼び出しエラー: ${response.status} ${errorText}`);
      
      // エラー時にレコードを更新
      await prisma.record.update({
        where: { id: newRecord.id },
        data: { 
          status: 'ERROR',
          error: `API呼び出しエラー: ${response.status}`,
        },
      });
      
      return NextResponse.json(
        { error: '処理の開始に失敗しました', details: errorText },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Cloud処理を開始しました', 
      recordId: newRecord.id 
    });
  } catch (error) {
    console.error('Cloud処理開始エラー:', error);
    return NextResponse.json(
      { error: '処理の開始に失敗しました', details: String(error) },
      { status: 500 }
    );
  }
}
