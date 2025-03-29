import { NextRequest, NextResponse } from "next/server";

// バックエンドAPIのURL
// 新しいカスタムドメインを使用
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.ririaru-stg.cloud";

export async function POST(request: NextRequest) {
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
      // タイムアウトを設定
      signal: AbortSignal.timeout(10000), // 10秒でタイムアウト
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
