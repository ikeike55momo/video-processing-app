import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// バックエンドAPIのURL（環境変数から取得、未設定の場合はデフォルト値を使用）
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://video-processing-api.onrender.com";

export async function POST(request: NextRequest) {
  // セッションチェック
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json(
      { error: "認証が必要です" },
      { status: 401 }
    );
  }
  try {
    // リクエストボディの取得
    const body = await request.json();

    console.log("アップロードURLリクエスト:", body);
    console.log("バックエンドAPI URL:", API_URL);

    // バックエンドAPIにリクエストを転送
    const backendResponse = await fetch(`${API_URL}/api/upload-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // バックエンドからのレスポンスを取得
    const data = await backendResponse.json();
    console.log("バックエンドAPIレスポンス:", data);

    // レスポンスコードを保持してクライアントに返す
    if (!backendResponse.ok) {
      console.error("バックエンドAPIエラー:", data);
      return NextResponse.json(
        { error: data.error || "バックエンドAPIでエラーが発生しました" },
        { status: backendResponse.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("アップロードURL生成エラー:", error);
    return NextResponse.json(
      { error: "アップロードURLの生成に失敗しました", details: String(error) },
      { status: 500 }
    );
  }
}
