import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(
  request: Request,
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
    
    // レコードの取得
    const record = await prisma.record.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      return NextResponse.json(
        { error: 'レコードが見つかりません' },
        { status: 404 }
      );
    }

    // バックエンドAPIから最新の状態を取得
    let backendStatus = null;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://video-processing-api.onrender.com';
      const response = await fetch(`${apiUrl}/api/records/${recordId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        backendStatus = await response.json();
        console.log('バックエンドAPIからの状態:', backendStatus);
        
        // バックエンドの状態でレコードを更新
        if (backendStatus.status && backendStatus.status !== record.status) {
          await prisma.record.update({
            where: { id: recordId },
            data: { 
              status: backendStatus.status,
              transcript_text: backendStatus.transcript_text || record.transcript_text,
              timestamps_json: backendStatus.timestamps_json || record.timestamps_json,
              summary_text: backendStatus.summary_text || record.summary_text,
              article_text: backendStatus.article_text || record.article_text,
              error: backendStatus.error || record.error
            },
          });
          
          // 更新後のレコードを再取得
          const updatedRecord = await prisma.record.findUnique({
            where: { id: recordId },
          });
          
          if (updatedRecord) {
            return NextResponse.json({
              id: updatedRecord.id,
              status: updatedRecord.status,
              error: updatedRecord.error,
              transcript_text: updatedRecord.transcript_text,
              timestamps_json: updatedRecord.timestamps_json,
              summary_text: updatedRecord.summary_text,
              article_text: updatedRecord.article_text,
              created_at: updatedRecord.created_at,
              backend_status: backendStatus
            });
          }
        }
      } else {
        console.error('バックエンドAPIからの状態取得エラー:', await response.text());
      }
    } catch (backendError) {
      console.error('バックエンドAPI通信エラー:', backendError);
    }

    // 処理状態を返す（バックエンドからの更新がない場合はローカルの状態を返す）
    return NextResponse.json({
      id: record.id,
      status: record.status,
      error: record.error,
      transcript_text: record.transcript_text,
      timestamps_json: record.timestamps_json,
      summary_text: record.summary_text,
      article_text: record.article_text,
      created_at: record.created_at,
      backend_status: backendStatus
    });
  } catch (error) {
    console.error('処理状態取得エラー:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '不明なエラーが発生しました' },
      { status: 500 }
    );
  }
}
