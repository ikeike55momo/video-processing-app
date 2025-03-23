import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    // セッションチェック
    const session = await getServerSession();
    if (!session?.user || (session.user && 'role' in session.user && session.user.role !== 'ADMIN')) {
      return NextResponse.json(
        { error: '管理者権限が必要です' },
        { status: 403 }
      );
    }

    // 全てのレコードを取得（削除されたものも含む）
    const records = await prisma.record.findMany({
      orderBy: {
        created_at: 'desc',
      },
    });

    return NextResponse.json({ records });
  } catch (error) {
    console.error('管理者レコード取得エラー:', error);
    return NextResponse.json(
      { error: '管理者レコードの取得に失敗しました' },
      { status: 500 }
    );
  }
}
