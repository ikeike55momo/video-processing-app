import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import axios from 'axios';

export async function POST(req: NextRequest) {
  try {
    // リクエストボディの解析
    const { fileUrl } = await req.json();
    
    if (!fileUrl) {
      return NextResponse.json(
        { error: 'ファイルURLが必要です' },
        { status: 400 }
      );
    }

    // デバッグ情報
    console.log('Cloud Run処理開始リクエスト:', { fileUrl });
    console.log('処理開始時刻:', new Date().toISOString());

    try {
      // レコードの検索
      const record = await prisma.record.findFirst({
        where: {
          file_url: fileUrl,
        },
      });

      // レコードが見つかった場合
      if (record) {
        console.log('レコードが見つかりました:', record);
        
        // ステータスをPROCESSINGに更新
        await prisma.record.update({
          where: {
            id: record.id,
          },
          data: {
            status: 'PROCESSING',
          },
        });

        // Cloud Run APIサービスにリクエストを送信
        const apiServiceUrl = process.env.API_SERVICE_URL;
        if (!apiServiceUrl) {
          throw new Error('API_SERVICE_URLが設定されていません');
        }

        console.log(`Cloud Run APIサービスURL: ${apiServiceUrl}`);
        
        try {
          const response = await axios.post(`${apiServiceUrl}/process`, {
            recordId: record.id,
            fileUrl: record.file_url
          });

          console.log('Cloud Run API レスポンス:', response.data);

          return NextResponse.json({ 
            success: true, 
            message: 'Cloud Run処理を開始しました', 
            recordId: record.id,
            cloudResponse: response.data
          });
        } catch (apiError: any) {
          console.error('Cloud Run API リクエストエラー:', apiError);
          console.error('エラー詳細:', apiError.response?.data || 'レスポンスデータなし');
          
          throw new Error(`Cloud Run APIリクエストエラー: ${apiError.message}`);
        }
      } 
      // レコードが見つからない場合
      else {
        console.log('レコードが見つかりません。新しいレコードを作成します。');
        
        // 新しいレコードを作成
        const newRecord = await prisma.record.create({
          data: {
            file_url: fileUrl,
            status: 'PROCESSING',
          },
        });
        
        console.log('新しいレコードを作成しました:', newRecord);

        // Cloud Run APIサービスにリクエストを送信
        const apiServiceUrl = process.env.API_SERVICE_URL;
        if (!apiServiceUrl) {
          throw new Error('API_SERVICE_URLが設定されていません');
        }

        console.log(`Cloud Run APIサービスURL: ${apiServiceUrl}`);
        
        try {
          const response = await axios.post(`${apiServiceUrl}/process`, {
            recordId: newRecord.id,
            fileUrl: newRecord.file_url
          });

          console.log('Cloud Run API レスポンス:', response.data);

          return NextResponse.json({ 
            success: true, 
            message: '新しいレコードを作成してCloud Run処理を開始しました', 
            recordId: newRecord.id,
            cloudResponse: response.data
          });
        } catch (apiError: any) {
          console.error('Cloud Run API リクエストエラー:', apiError);
          console.error('エラー詳細:', apiError.response?.data || 'レスポンスデータなし');
          
          throw new Error(`Cloud Run APIリクエストエラー: ${apiError.message}`);
        }
      }
    } catch (dbError) {
      console.error('データベース操作またはCloud Run APIリクエストエラー:', dbError);
      return NextResponse.json(
        { error: 'データベース操作またはCloud Run APIリクエストに失敗しました', details: dbError instanceof Error ? dbError.message : String(dbError) },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('処理開始エラー:', error);
    return NextResponse.json(
      { error: '処理の開始に失敗しました', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
