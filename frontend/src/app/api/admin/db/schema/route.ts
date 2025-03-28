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

// データベーススキーマ情報を取得するAPI
export async function GET(req: NextRequest) {
  try {
    // 管理者チェック
    if (!await isAdmin()) {
      return NextResponse.json(
        { error: '管理者権限が必要です' },
        { status: 403 }
      );
    }

    // スキーマ情報を取得（Prismaの内部APIを使用）
    const schemaInfo = await prisma.$queryRaw`
      SELECT 
        table_name, 
        column_name, 
        data_type, 
        character_maximum_length,
        is_nullable
      FROM 
        information_schema.columns
      WHERE 
        table_schema = 'public'
      ORDER BY 
        table_name, ordinal_position
    `;

    return NextResponse.json({ schema: schemaInfo });
  } catch (error) {
    console.error('スキーマ情報取得エラー:', error);
    return NextResponse.json(
      { error: 'スキーマ情報の取得に失敗しました' },
      { status: 500 }
    );
  }
}
