import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateUploadUrl, generateAppropriateUploadUrl } from "@/lib/storage";

export async function POST(request: NextRequest) {
  try {
    // セッションの確認
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    // リクエストボディの取得
    const { fileName, contentType, fileSize } = await request.json();

    // 必須パラメータの確認
    if (!fileName || !contentType) {
      return NextResponse.json(
        { error: "fileName と contentType は必須です" },
        { status: 400 }
      );
    }

    // ファイルサイズに基づいて適切なアップロード方法を選択
    let result;
    if (fileSize && fileSize > 0) {
      // ファイルサイズが指定されている場合は適切な方法を選択
      result = await generateAppropriateUploadUrl(fileName, contentType, fileSize);
    } else {
      // 従来の方法（小さいファイル用）
      result = await generateUploadUrl(fileName, contentType);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("アップロードURL生成エラー:", error);
    return NextResponse.json(
      { error: "アップロードURLの生成に失敗しました" },
      { status: 500 }
    );
  }
}
