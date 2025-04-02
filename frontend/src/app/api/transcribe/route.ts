import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    // セッションチェック
    const session = await getServerSession(authOptions);
    console.log("transcribe API - セッション情報:", session);
    
    // セッションチェックを一時的に無効化（デバッグ用）
    // if (!session) {
    //   console.error("transcribe API - 認証エラー: セッションがありません");
    //   return NextResponse.json(
    //     { error: '認証が必要です' },
    //     { status: 401 }
    //   );
    // }

    // リクエストボディを解析
    const body = await request.json();
    const { fileUrl } = body;

    if (!fileUrl) {
      return NextResponse.json(
        { error: 'fileUrlは必須です' },
        { status: 400 }
      );
    }

    // 同じURLの処理中レコードを検索
    const existingRecords = await prisma.record.findMany({
      where: { 
        file_url: fileUrl,
        status: 'PROCESSING'
      },
    });
    
    // 処理中のレコードがあれば削除（論理削除）
    if (existingRecords.length > 0) {
      console.log(`同じURLの処理中レコードが${existingRecords.length}件見つかりました。削除します。`);
      for (const existingRecord of existingRecords) {
        await prisma.record.update({
          where: { id: existingRecord.id },
          data: { 
            deleted_at: new Date(),
            status: 'ERROR'
          },
        });
      }
    }

    // 新しいレコードを作成
    const record = await prisma.record.create({
      data: {
        status: 'PROCESSING', // 処理中に設定
        file_url: fileUrl
      },
    });

    console.log('新しいレコードを作成しました:', record);

    // バックエンドAPIに処理開始リクエストを送信
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://video-processing-api.onrender.com';
    console.log(`バックエンドAPIに処理リクエストを送信: ${apiUrl}/api/process`);
    
    const processResponse = await fetch(`${apiUrl}/api/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recordId: record.id,
        fileUrl: fileUrl,
      }),
    });

    if (!processResponse.ok) {
      const errorText = await processResponse.text();
      console.error('バックエンドAPI処理エラー:', errorText);
      
      // エラー情報をデータベースに保存
      await prisma.record.update({
        where: { id: record.id },
        data: { 
          status: 'ERROR',
          error: `処理の開始に失敗しました: ${errorText}`
        },
      });
      
      throw new Error(`処理の開始に失敗しました: ${errorText}`);
    }

    const processResult = await processResponse.json();
    console.log('バックエンドAPI処理結果:', processResult);

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
