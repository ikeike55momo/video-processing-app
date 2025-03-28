import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';

// 管理者ユーザーIDのリスト（実際の環境では環境変数などで管理）
const ADMIN_USER_IDS = ['admin1', 'admin2'];

// 管理者かどうかチェックする関数
async function isAdmin() {
  const session = await getServerSession();
  if (!session || !session.user || !session.user.email) {
    return false;
  }
  
  // 特定のメールアドレスを管理者として認識
  const adminEmails = ['ikeike55momo@gmail.com'];
  return adminEmails.includes(session.user.email);
}

// レコード一覧を取得するAPI
export async function GET(req: NextRequest) {
  try {
    // 管理者チェック
    if (!await isAdmin()) {
      return NextResponse.json(
        { error: '管理者権限が必要です' },
        { status: 403 }
      );
    }

    // クエリパラメータの取得
    const { searchParams } = new URL(req.url);
    const recordId = searchParams.get('id');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    // 特定のレコードの詳細を取得
    if (recordId) {
      const record = await prisma.record.findUnique({
        where: { id: recordId }
      });

      if (!record) {
        return NextResponse.json(
          { error: 'レコードが見つかりません' },
          { status: 404 }
        );
      }

      return NextResponse.json({ record });
    }

    // レコード一覧を取得
    const records = await prisma.record.findMany({
      take: limit,
      skip: offset,
      orderBy: { created_at: 'desc' }
    });

    // レコード総数を取得
    const total = await prisma.record.count();

    return NextResponse.json({
      records,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + records.length < total
      }
    });
  } catch (error) {
    console.error('管理者APIエラー:', error);
    return NextResponse.json(
      { error: 'データベースの取得に失敗しました' },
      { status: 500 }
    );
  }
}
