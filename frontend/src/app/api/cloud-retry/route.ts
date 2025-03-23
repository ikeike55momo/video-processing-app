import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import axios from 'axios';

export async function POST(req: NextRequest) {
  try {
    // リクエストボディの解析
    const { recordId } = await req.json();
    
    if (!recordId) {
      return NextResponse.json(
        { error: 'レコードIDが必要です' },
        { status: 400 }
      );
    }

    // デバッグ情報
    console.log('Cloud Run再試行リクエスト:', { recordId });
    console.log('再試行開始時刻:', new Date().toISOString());

    try {
      // レコードの取得
      const record = await prisma.record.findUnique({
        where: { id: recordId },
      });

      if (!record) {
        return NextResponse.json(
          { error: '指定されたレコードが見つかりません' },
          { status: 404 }
        );
      }

      // ステータスをPROCESSINGに更新
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          status: 'PROCESSING',
          error: null
        },
      });

      // Cloud Run APIサービスにリクエストを送信
      const apiServiceUrl = process.env.API_SERVICE_URL;
      if (!apiServiceUrl) {
        throw new Error('API_SERVICE_URLが設定されていません');
      }

      const response = await axios.post(`${apiServiceUrl}/records/${recordId}/retry`, {});

      return NextResponse.json({ 
        success: true, 
        message: 'Cloud Run再試行処理を開始しました', 
        recordId: recordId,
        cloudResponse: response.data
      });
    } catch (error) {
      console.error('再試行エラー:', error);
      return NextResponse.json(
        { error: '処理の再試行に失敗しました', details: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('再試行リクエストエラー:', error);
    return NextResponse.json(
      { error: '再試行リクエストの処理に失敗しました', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
