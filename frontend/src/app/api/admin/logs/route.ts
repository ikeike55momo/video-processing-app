import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import os from 'os';
import prisma from '@/lib/prisma';

// ログの最大行数
const MAX_LOG_LINES = 1000;

export async function GET(req: NextRequest) {
  try {
    // セッションチェック
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    // 実際のログとシステムステータスを取得
    const { logs, systemStatus } = await getRealTimeLogsAndStatus();

    return NextResponse.json({ logs, systemStatus });
  } catch (error) {
    console.error('ログ取得エラー:', error);
    return NextResponse.json(
      { error: 'ログの取得に失敗しました' },
      { status: 500 }
    );
  }
}

// 実際のログとシステムステータスを取得する関数
async function getRealTimeLogsAndStatus(): Promise<{ logs: string[], systemStatus: any }> {
  try {
    // システムリソース情報
    const systemInfo = [
      `[${new Date().toISOString()}] === システム情報 ===`,
      `[${new Date().toISOString()}] 環境: ${process.env.NODE_ENV || 'development'}`,
      `[${new Date().toISOString()}] プラットフォーム: ${os.platform()} ${os.release()}`,
      `[${new Date().toISOString()}] メモリ使用量: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB / ${Math.round(os.totalmem() / 1024 / 1024)} MB`,
      `[${new Date().toISOString()}] CPU使用率: ${os.loadavg().join(', ')}`,
      `[${new Date().toISOString()}] アップタイム: ${Math.floor(os.uptime() / 3600)} 時間 ${Math.floor((os.uptime() % 3600) / 60)} 分`,
    ];

    // データベースからレコードを取得
    const records = await prisma.record.findMany({
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    // 処理状況の集計
    const statusCounts = {
      UPLOADED: 0,
      PROCESSING: 0,
      DONE: 0,
      ERROR: 0,
    };

    // 最新のエラーを取得
    let latestErrors: string[] = [];

    // レコードの処理状況を集計
    records.forEach(record => {
      if (record.status) {
        statusCounts[record.status as keyof typeof statusCounts]++;
      }
      
      // エラー情報を収集
      if (record.status === 'ERROR' && record.error) {
        latestErrors.push(`[${new Date(record.created_at).toISOString()}] レコードID: ${record.id} - エラー: ${record.error}`);
      }
    });

    // 処理状況のログ
    const processingStatus = [
      `[${new Date().toISOString()}] === 処理状況 ===`,
      `[${new Date().toISOString()}] アップロード済み: ${statusCounts.UPLOADED}`,
      `[${new Date().toISOString()}] 処理中: ${statusCounts.PROCESSING}`,
      `[${new Date().toISOString()}] 完了: ${statusCounts.DONE}`,
      `[${new Date().toISOString()}] エラー: ${statusCounts.ERROR}`,
    ];

    // エラーログ
    const errorLogs = latestErrors.length > 0 
      ? [
          `[${new Date().toISOString()}] === 最新のエラー ===`,
          ...latestErrors
        ]
      : [`[${new Date().toISOString()}] エラーは検出されていません`];

    // API状態のチェック
    const apiStatus = {
      gemini: await checkGeminiApiStatus(),
      claude: await checkClaudeApiStatus(),
      database: await checkDatabaseStatus(),
    };

    // API状態のログ
    const apiStatusLogs = [
      `[${new Date().toISOString()}] === API状態 ===`,
      `[${new Date().toISOString()}] Gemini API: ${apiStatus.gemini}`,
      `[${new Date().toISOString()}] Claude API: ${apiStatus.claude}`,
      `[${new Date().toISOString()}] データベース: ${apiStatus.database}`,
    ];

    // 最新の処理ログを取得（最大10件）
    const recentProcessingLogs = await getRecentProcessingLogs();

    // すべてのログを結合
    const allLogs = [
      ...systemInfo,
      `[${new Date().toISOString()}] -----------------------------------------------`,
      ...processingStatus,
      `[${new Date().toISOString()}] -----------------------------------------------`,
      ...apiStatusLogs,
      `[${new Date().toISOString()}] -----------------------------------------------`,
      ...errorLogs,
      `[${new Date().toISOString()}] -----------------------------------------------`,
      `[${new Date().toISOString()}] === 最新の処理ログ ===`,
      ...recentProcessingLogs,
    ];

    // システムステータスを返す
    const systemStatus = {
      resources: {
        memory: {
          used: Math.round(process.memoryUsage().rss / 1024 / 1024),
          total: Math.round(os.totalmem() / 1024 / 1024),
          unit: 'MB'
        },
        cpu: os.loadavg()[0],
        uptime: {
          hours: Math.floor(os.uptime() / 3600),
          minutes: Math.floor((os.uptime() % 3600) / 60)
        }
      },
      processing: statusCounts,
      api: apiStatus,
      errors: latestErrors.slice(0, 5)
    };

    return { logs: allLogs, systemStatus };
  } catch (error) {
    console.error('ログとステータス取得エラー:', error);
    return { 
      logs: [`[${new Date().toISOString()}] ログとステータスの取得に失敗しました: ${error}`],
      systemStatus: { error: 'ステータス取得エラー' }
    };
  }
}

// 最新の処理ログを取得する関数
async function getRecentProcessingLogs(): Promise<string[]> {
  try {
    // 最新のレコードを取得
    const latestRecord = await prisma.record.findFirst({
      orderBy: { created_at: 'desc' },
    });

    if (!latestRecord) {
      return ['処理ログはありません'];
    }

    // 処理ステップに応じたログを生成
    const logs = [
      `[${new Date(latestRecord.created_at).toISOString()}] レコードID: ${latestRecord.id} - ステータス: ${latestRecord.status}`,
    ];

    if (latestRecord.file_url) {
      logs.push(`[${new Date(latestRecord.created_at).toISOString()}] ファイルURL: ${latestRecord.file_url}`);
    }

    if (latestRecord.transcript_text) {
      logs.push(`[${new Date(latestRecord.created_at).toISOString()}] 文字起こし: 完了 (${latestRecord.transcript_text.length} 文字)`);
    } else {
      logs.push(`[${new Date(latestRecord.created_at).toISOString()}] 文字起こし: 未完了`);
    }

    if (latestRecord.summary_text) {
      logs.push(`[${new Date(latestRecord.created_at).toISOString()}] 要約: 完了 (${latestRecord.summary_text.length} 文字)`);
    } else {
      logs.push(`[${new Date(latestRecord.created_at).toISOString()}] 要約: 未完了`);
    }

    if (latestRecord.article_text) {
      logs.push(`[${new Date(latestRecord.created_at).toISOString()}] 記事生成: 完了 (${latestRecord.article_text.length} 文字)`);
    } else {
      logs.push(`[${new Date(latestRecord.created_at).toISOString()}] 記事生成: 未完了`);
    }

    if (latestRecord.error) {
      logs.push(`[${new Date(latestRecord.created_at).toISOString()}] エラー: ${latestRecord.error}`);
    }

    return logs;
  } catch (error) {
    console.error('処理ログ取得エラー:', error);
    return [`[${new Date().toISOString()}] 処理ログの取得に失敗しました: ${error}`];
  }
}

// Gemini API状態をチェックする関数
async function checkGeminiApiStatus(): Promise<string> {
  try {
    // 実際の実装では、Gemini APIの状態を確認する
    // ここではAPIキーが設定されているかどうかをチェック
    return process.env.GEMINI_API_KEY ? 'OK' : 'ERROR (APIキーが設定されていません)';
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : '不明なエラー'}`;
  }
}

// Claude API状態をチェックする関数
async function checkClaudeApiStatus(): Promise<string> {
  try {
    // 実際の実装では、Claude APIの状態を確認する
    // ここではAPIキーが設定されているかどうかをチェック
    return process.env.OPENROUTER_API_KEY ? 'OK' : 'ERROR (APIキーが設定されていません)';
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : '不明なエラー'}`;
  }
}

// データベース状態をチェックする関数
async function checkDatabaseStatus(): Promise<string> {
  try {
    // 簡易的な接続テスト
    await prisma.$queryRaw`SELECT 1`;
    return 'OK';
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : '不明なエラー'}`;
  }
}
