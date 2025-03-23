import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    // セッションチェックを一時的に無効化（デバッグ用）
    // const session = await getServerSession();
    // if (!session) {
    //   return NextResponse.json(
    //     { error: '認証が必要です' },
    //     { status: 401 }
    //   );
    // }

    // 全てのレコードを取得（削除されていないもののみ）
    const records = await prisma.record.findMany({
      where: {
        deleted_at: null,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    return NextResponse.json({ records });
  } catch (error) {
    console.error('レコード取得エラー:', error);
    return NextResponse.json(
      { error: 'レコードの取得に失敗しました' },
      { status: 500 }
    );
  }
}
