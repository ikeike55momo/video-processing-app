import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // セッションチェック
    const session = await getServerSession();
    if (!session?.user || (session.user && 'role' in session.user && session.user.role !== 'ADMIN')) {
      return NextResponse.json(
        { error: '管理者権限が必要です' },
        { status: 403 }
      );
    }

    const recordId = params.id;
    
    if (!recordId) {
      return NextResponse.json(
        { error: 'レコードIDが必要です' },
        { status: 400 }
      );
    }

    // レコードの詳細情報を取得
    const record = await prisma.record.findUnique({
      where: {
        id: recordId,
      },
    });

    if (!record) {
      return NextResponse.json(
        { error: '指定されたレコードが見つかりません' },
        { status: 404 }
      );
    }

    // 処理ログの取得（実際の実装では、別テーブルからログを取得）
    const logs = [
      { timestamp: new Date(record.created_at).toISOString(), message: 'レコード作成' },
      { timestamp: new Date(new Date(record.created_at).getTime() + 60000).toISOString(), message: '処理開始' },
    ];

    // ステータスに応じてログを追加
    if (record.transcript_text) {
      logs.push({ 
        timestamp: new Date(new Date(record.created_at).getTime() + 120000).toISOString(), 
        message: '文字起こし完了' 
      });
    }

    if (record.summary_text) {
      logs.push({ 
        timestamp: new Date(new Date(record.created_at).getTime() + 180000).toISOString(), 
        message: '要約完了' 
      });
    }

    if (record.article_text) {
      logs.push({ 
        timestamp: new Date(new Date(record.created_at).getTime() + 240000).toISOString(), 
        message: '記事生成完了' 
      });
    }

    if (record.status === 'ERROR') {
      logs.push({ 
        timestamp: new Date(new Date(record.created_at).getTime() + 300000).toISOString(), 
        message: `エラー発生: 不明なエラー` 
      });
    }

    return NextResponse.json({ 
      record,
      logs
    });
  } catch (error) {
    console.error('レコード詳細取得エラー:', error);
    return NextResponse.json(
      { error: 'レコード詳細の取得に失敗しました' },
      { status: 500 }
    );
  }
}
