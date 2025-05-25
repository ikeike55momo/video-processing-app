import { NextRequest, NextResponse } from "next/server";

// 環境変数チェックエンドポイント
export async function GET(request: NextRequest) {
  try {
    // R2ストレージの環境変数をチェック
    const r2AccessKeyId = process.env.NEXT_PUBLIC_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
    const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const r2Endpoint = process.env.NEXT_PUBLIC_R2_ENDPOINT || process.env.R2_ENDPOINT;
    const r2BucketName = process.env.NEXT_PUBLIC_R2_BUCKET_NAME || process.env.R2_BUCKET_NAME;
    const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL;

    // 環境変数の状態を返す
    const envStatus = {
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
      // デバッグ情報
      envKeys: Object.keys(process.env).filter(key => key.includes('R2_') || key.includes('NEXT_PUBLIC_')),
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
    };

    // isConfiguredフラグを設定
    const isConfigured = envStatus.hasAccessKey && envStatus.hasSecretKey && 
                         envStatus.hasEndpoint && envStatus.hasBucket;

    console.log('環境変数チェック（サーバーサイド）:', {
      ...envStatus,
      isConfigured
    });

    return NextResponse.json({
      ...envStatus,
      isConfigured
    });
  } catch (error) {
    console.error("環境変数チェックエラー:", error);
    return NextResponse.json(
      { error: "環境変数チェック中にエラーが発生しました", details: String(error) },
      { status: 500 }
    );
  }
}
