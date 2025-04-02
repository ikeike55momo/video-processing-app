import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// バックエンドAPIのURL（環境変数から取得、未設定の場合はデフォルト値を使用）
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://video-processing-api.onrender.com";

export async function POST(request: NextRequest) {
  // セッションチェック
  const session = await getServerSession(authOptions);
  console.log("upload-url API - セッション情報:", session);
  
  if (!session) {
    console.error("upload-url API - 認証エラー: セッションがありません");
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
    console.log(`バックエンドAPIリクエスト送信: ${API_URL}/api/upload-url`);
    console.log("リクエストボディ:", JSON.stringify(body));
    
    let data;
    let backendResponse;
    
    try {
      backendResponse = await fetch(`${API_URL}/api/upload-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      
      console.log("バックエンドAPIレスポンスステータス:", backendResponse.status);
      console.log("バックエンドAPIレスポンスヘッダー:", Object.fromEntries(backendResponse.headers.entries()));
      
      // レスポンスのテキストを取得
      const responseText = await backendResponse.text();
      console.log("バックエンドAPIレスポンステキスト:", responseText);
      
      // JSONとして解析
      try {
        data = JSON.parse(responseText);
        console.log("バックエンドAPIレスポンスJSON:", data);
      } catch (jsonError) {
        console.error("JSONパースエラー:", jsonError);
        throw new Error(`バックエンドAPIからの応答をJSONとして解析できません: ${responseText}`);
      }
    } catch (fetchError) {
      console.error("バックエンドAPIリクエストエラー:", fetchError);
      throw new Error(`バックエンドAPIへのリクエストに失敗しました: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
    }

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
