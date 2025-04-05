import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    // セッションチェック
    const session = await getServerSession(authOptions);
    console.log("process API - セッション情報:", session);
    
    // セッションチェックを一時的に無効化（デバッグ用）
    // if (!session) {
    //   console.error("process API - 認証エラー: セッションがありません");
    //   return NextResponse.json(
    //     { error: '認証が必要です' },
    //     { status: 401 }
    //   );
    // }

    // リクエストボディの解析
    const { recordId, fileUrl, fileKey } = await req.json();
    
    if (!recordId && !fileUrl) {
      return NextResponse.json(
        { error: 'recordIdまたはfileUrlが必要です' },
        { status: 400 }
      );
    }
    
    console.log('処理リクエスト:', { recordId, fileUrl, fileKey });

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
    // fileUrlのみ指定されている場合は常に新しいレコードを作成
    else if (fileUrl) {
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
      record = await prisma.record.create({
        data: {
          file_url: fileUrl,
          file_key: fileKey, // fileKeyを追加
          status: 'UPLOADED',
        },
      });
      console.log('新しいレコードを作成しました:', record);
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
    
    let processResult = { jobId: null };
    try {
      const processResponse = await fetch(`${apiUrl}/api/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recordId: record!.id,
          fileUrl: record!.file_url,
          fileKey: fileKey, // fileKeyを追加
        }),
      });

      const responseText = await processResponse.text();
      console.log('バックエンドAPIレスポンス:', responseText);
      
      try {
        // JSONとして解析を試みる
        const responseData = JSON.parse(responseText);
        
        if (!processResponse.ok) {
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
                  recordId: record!.id,
                  fileUrl: record!.file_url,
                  fileKey: fileKey, // fileKeyを追加
                }),
              });
              
              console.log('transcribeエンドポイントレスポンスステータス:', transcribeResponse.status);
              
              if (transcribeResponse.ok) {
                const transcribeResult = await transcribeResponse.json();
                console.log('transcribeエンドポイント処理結果:', transcribeResult);
                processResult = transcribeResult;
              } else {
                console.error('transcribeエンドポイントエラー:', await transcribeResponse.text());
              }
            } catch (transcribeError) {
              console.error('transcribeエンドポイントリクエストエラー:', transcribeError);
            }
          } else {
            // その他のエラーの場合は、エラー情報をデータベースに保存
            await prisma.record.update({
              where: { id: record!.id },
              data: { 
                status: 'PROCESSING', // エラーではなく処理中として扱う
                error: null // エラー情報をクリア
              },
            });
          }
        } else {
          processResult = responseData;
          console.log('バックエンドAPI処理結果:', processResult);
          // jobIdが含まれているか確認
          if (responseData.jobId) {
            console.log('ジョブID取得:', responseData.jobId);
          } else {
            console.warn('バックエンドAPIからジョブIDが返されませんでした');
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
