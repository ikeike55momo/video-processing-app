import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// バックエンドAPIのURL
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.ririaru-stg.cloud";

export async function POST(req: NextRequest) {
  try {
    // セッションの確認
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    // リクエストボディの取得
    const body = await req.json();

    // バックエンドAPIにリクエストを転送
    const backendResponse = await fetch(`${API_URL}/api/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // タイムアウトを設定
      signal: AbortSignal.timeout(30000), // 30秒でタイムアウト
    });

    // バックエンドからのレスポンスを取得
    const data = await backendResponse.json();

    // レスポンスコードを保持してクライアントに返す
    if (!backendResponse.ok) {
      return NextResponse.json(
        { error: data.error || "バックエンドAPIでエラーが発生しました" },
        { status: backendResponse.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("処理リクエストエラー:", error);
    return NextResponse.json(
      { error: "処理リクエストに失敗しました", details: String(error) },
      { status: 500 }
    );
  }
}
