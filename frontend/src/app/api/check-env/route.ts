import { NextRequest, NextResponse } from "next/server";

// 環境変数チェックエンドポイント
export async function GET(request: NextRequest) {
  try {
    // R2ストレージの環境変数をチェック
    const r2AccessKeyId = process.env.NEXT_PUBLIC_R2_ACCESS_KEY_ID;
    const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const r2Endpoint = process.env.NEXT_PUBLIC_R2_ENDPOINT;
    const r2BucketName = process.env.NEXT_PUBLIC_R2_BUCKET_NAME;
    const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

    // 環境変数の状態を返す
    return NextResponse.json({
      hasAccessKey: !!r2AccessKeyId,
      hasSecretKey: !!r2SecretAccessKey,
      hasEndpoint: !!r2Endpoint,
      hasBucket: !!r2BucketName,
      hasPublicUrl: !!r2PublicUrl,
      // 値の長さ情報（セキュリティのため実際の値は含めない）
      accessKeyLength: r2AccessKeyId?.length || 0,
      secretKeyLength: r2SecretAccessKey?.length || 0,
      endpoint: r2Endpoint || '',
      bucket: r2BucketName || '',
      publicUrl: r2PublicUrl || '',
    });
  } catch (error) {
    console.error("環境変数チェックエラー:", error);
    return NextResponse.json(
      { error: "環境変数チェック中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
