import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    // セッションチェック
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    // リクエストボディの解析
    const { recordId, fileUrl } = await req.json();
    
    if (!recordId && !fileUrl) {
      return NextResponse.json(
        { error: 'recordIdまたはfileUrlが必要です' },
        { status: 400 }
      );
    }

    let record;
    
    // recordIdが指定されている場合はそのレコードを使用
    if (recordId) {
      record = await prisma.record.findUnique({
        where: { id: recordId },
      });
      
      if (!record) {
        return NextResponse.json(
          { error: '指定されたレコードが見つかりません' },
          { status: 404 }
        );
      }
    } 
    // fileUrlのみ指定されている場合はレコードを検索または作成
    else if (fileUrl) {
      // 既存のレコードを検索
      record = await prisma.record.findFirst({
        where: { file_url: fileUrl },
      });
      
      // レコードが見つからない場合は新規作成
      if (!record) {
        record = await prisma.record.create({
          data: {
            file_url: fileUrl,
            status: 'UPLOADED',
          },
        });
        console.log('新しいレコードを作成しました:', record);
      }
    }

    // ステータスをPROCESSINGに更新
    await prisma.record.update({
      where: { id: record!.id },
      data: { 
        status: 'PROCESSING',
        error: null // エラー情報をクリア
      },
    });

    // バックエンドAPIに処理開始リクエストを送信
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://video-processing-api.onrender.com';
    console.log(`バックエンドAPIに処理リクエストを送信: ${apiUrl}/api/process`);
    
    const processResponse = await fetch(`${apiUrl}/api/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recordId: record!.id,
        fileUrl: record!.file_url,
      }),
    });

    if (!processResponse.ok) {
      const errorText = await processResponse.text();
      console.error('バックエンドAPI処理エラー:', errorText);
      
      // エラー情報をデータベースに保存
      await prisma.record.update({
        where: { id: record!.id },
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
      success: true,
      message: '処理を開始しました',
      recordId: record!.id,
      jobId: processResult.jobId || null,
    });
  } catch (error) {
    console.error('処理開始エラー:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '処理の開始に失敗しました' },
      { status: 500 }
    );
  }
}
