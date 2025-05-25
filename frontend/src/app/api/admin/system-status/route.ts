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

    // システムステータスの取得
    // 実際の実装では、外部APIやサービスから情報を取得
    const systemStatus = {
      apiLimits: { 
        gemini: checkApiLimit('gemini'),
        claude: checkApiLimit('claude')
      },
      storage: checkStorageStatus(),
      database: checkDatabaseStatus(),
    };

    return NextResponse.json(systemStatus);
  } catch (error) {
    console.error('システムステータス取得エラー:', error);
    return NextResponse.json(
      { error: 'システムステータスの取得に失敗しました' },
      { status: 500 }
    );
  }
}

// APIの使用制限をチェック（デモ用の簡易実装）
function checkApiLimit(api: string): string {
  // 実際の実装では、APIの使用量や制限を取得
  // ここではデモ用にランダムな状態を返す
  const random = Math.random();
  if (random > 0.9) {
    return 'WARNING'; // 10%の確率で警告
  } else if (random > 0.95) {
    return 'ERROR'; // 5%の確率でエラー
  } else {
    return 'OK'; // 85%の確率で正常
  }
}

// ストレージ状態をチェック（デモ用の簡易実装）
function checkStorageStatus(): string {
  // 実際の実装では、Google Cloud Storageの状態を取得
  return Math.random() > 0.95 ? 'WARNING' : 'OK';
}

// データベース状態をチェック（デモ用の簡易実装）
function checkDatabaseStatus(): string {
  // 実際の実装では、データベース接続状態を確認
  try {
    // 簡易的な接続テスト
    prisma.$queryRaw`SELECT 1`;
    return 'OK';
  } catch (error) {
    console.error('データベース接続エラー:', error);
    return 'ERROR';
  }
}
