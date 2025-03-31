import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import prisma from '@/lib/prisma';

/**
 * ファイルキーからレコードIDを取得するAPI
 */
export async function POST(request: NextRequest) {
  try {
    // セッション確認（認証済みユーザーのみ許可）
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    // リクエストボディを取得
    const body = await request.json();
    const { fileKey } = body;

    if (!fileKey) {
      return NextResponse.json(
        { error: 'ファイルキーは必須です' },
        { status: 400 }
      );
    }

    console.log(`ファイルキー ${fileKey} からレコードを検索中...`);

    // ファイルキーからレコードを検索
    const record = await prisma.record.findFirst({
      where: { file_key: fileKey }
    });

    if (!record) {
      return NextResponse.json(
        { error: 'レコードが見つかりません', details: `ファイルキー ${fileKey} に対応するレコードが存在しません` },
        { status: 404 }
      );
    }

    console.log(`レコードが見つかりました: ${record.id}`);

    // レスポンスを返す
    return NextResponse.json({
      recordId: record.id,
      status: record.status
    });
  } catch (error) {
    console.error('レコード取得エラー:', error);
    return NextResponse.json(
      {
        error: 'レコードの取得に失敗しました',
        details: error instanceof Error ? error.message : '不明なエラー',
      },
      { status: 500 }
    );
  }
}
