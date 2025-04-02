import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    // セッションチェック
    const session = await getServerSession(authOptions);
    console.log("process-cloud API - セッション情報:", session);
    
    // セッションチェックを一時的に無効化（デバッグ用）
    // if (!session) {
    //   console.error("process-cloud API - 認証エラー: セッションがありません");
    //   return NextResponse.json(
    //     { error: '認証が必要です' },
    //     { status: 401 }
    //   );
    // }

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
    const newRecord = await prisma.record.create({
      data: {
        file_url: fileUrl,
        status: 'PROCESSING',
      },
    });
    
    console.log('新しいレコードを作成しました:', newRecord);

    // バックエンドAPIに処理を依頼
    try {
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

      const responseText = await response.text();
      console.log('バックエンドAPIレスポンス:', responseText);
      
      try {
        // JSONとして解析を試みる
        const responseData = JSON.parse(responseText);
        
        if (!response.ok) {
          console.warn('バックエンドAPI処理警告:', responseData);
          
          // 「既に処理中」エラーの場合は、transcribeエンドポイントを呼び出す
          if (responseData.error && responseData.error.includes("already being processed")) {
            console.log('レコードは既に処理中です。transcribeエンドポイントを呼び出します。');
            
            // transcribeエンドポイントを呼び出す
            try {
              const transcribeResponse = await fetch(`${apiUrl}/api/transcribe`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  recordId: newRecord.id,
                  fileUrl,
                }),
              });
              
              console.log('transcribeエンドポイントレスポンスステータス:', transcribeResponse.status);
              
              if (transcribeResponse.ok) {
                const transcribeResult = await transcribeResponse.json();
                console.log('transcribeエンドポイント処理結果:', transcribeResult);
              } else {
                console.error('transcribeエンドポイントエラー:', await transcribeResponse.text());
              }
            } catch (transcribeError) {
              console.error('transcribeエンドポイントリクエストエラー:', transcribeError);
            }
          } else {
            // その他のエラーの場合でも、処理中として扱う
            console.log('エラーが発生しましたが、処理を続行します。');
          }
        }
      } catch (jsonError) {
        console.error('JSONパースエラー:', jsonError);
        // JSONパースエラーの場合でも処理を続行
      }
    } catch (fetchError) {
      console.error('バックエンドAPIリクエストエラー:', fetchError);
      // フェッチエラーの場合でも処理を続行
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
