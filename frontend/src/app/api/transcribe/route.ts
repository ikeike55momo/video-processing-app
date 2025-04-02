import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    console.log('transcribeエンドポイント: リクエスト受信');
    
    // セッションチェック（開発環境では一時的にスキップ）
    const session = await getServerSession();
    if (!session && process.env.NODE_ENV !== 'development') {
      console.error('transcribeエンドポイント: 認証エラー - セッションなし');
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }
    
    console.log('transcribeエンドポイント: 認証OK');

    // リクエストボディの解析
    const body = await req.json();
    console.log('transcribeエンドポイント: リクエストボディ', body);
    
    const { fileKey, fileName } = body;
    
    if (!fileKey) {
      console.error('transcribeエンドポイント: fileKeyが見つかりません');
      return NextResponse.json(
        { error: 'ファイルキーが必要です' },
        { status: 400 }
      );
    }

    // R2のパブリックURLを構築
    const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
    console.log('transcribeエンドポイント: R2_PUBLIC_URL', R2_PUBLIC_URL);
    
    const fileUrl = `${R2_PUBLIC_URL}/${fileKey}`;
    console.log('transcribeエンドポイント: 構築したfileUrl', fileUrl);

    // 直接データベースに記録を作成
    try {
      const record = await prisma.record.create({
        data: {
          file_url: fileUrl,
          status: 'UPLOADED',
        },
      });
      
      console.log('transcribeエンドポイント: レコード作成成功', record);

      // 処理パイプラインを開始
      const { ProcessingPipeline } = await import('@/app/services/processing-pipeline');
      const pipeline = new ProcessingPipeline();
      
      // 非同期で処理を開始
      pipeline.processVideo(record.id).catch(error => {
        console.error('処理パイプラインエラー:', error);
      });
      
      return NextResponse.json({
        success: true,
        message: 'AI処理パイプラインを開始しました',
        recordId: record.id,
        jobId: record.id // 互換性のためにrecordIdをjobIdとしても返す
      });
    } catch (dbError) {
      console.error('transcribeエンドポイント: データベースエラー', dbError);
      
      // データベースエラーの場合はプロセスエンドポイントにフォールバック
      console.log('transcribeエンドポイント: /api/processにフォールバック');
      
      const processUrl = `${req.nextUrl.origin}/api/process`;
      console.log('transcribeエンドポイント: processUrl', processUrl);
      
      const processResponse = await fetch(processUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileUrl }),
      });

      if (!processResponse.ok) {
        const errorText = await processResponse.text();
        console.error('transcribeエンドポイント: /api/processからのエラー', errorText);
        return NextResponse.json(
          { error: '処理の開始に失敗しました' },
          { status: processResponse.status }
        );
      }

      const result = await processResponse.json();
      console.log('transcribeエンドポイント: /api/processからの応答', result);
      
      return NextResponse.json({
        success: true,
        message: 'フォールバック: AI処理パイプラインを開始しました',
        recordId: result.recordId,
        jobId: result.recordId
      });
    }
  } catch (error) {
    console.error('transcribeエンドポイント: 予期せぬエラー', error);
    return NextResponse.json(
      { error: '処理の開始に失敗しました' },
      { status: 500 }
    );
  }
}
