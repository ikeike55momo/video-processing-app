import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';

/**
 * ファイルアップロード用の署名付きURLを生成するAPI
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
    const { fileName, fileKey } = body;

    if (!fileName || !fileKey) {
      return NextResponse.json(
        { error: 'ファイル名とファイルキーは必須です' },
        { status: 400 }
      );
    }

    // R2クライアントの初期化
    const r2Client = new S3Client({
      region: 'auto',
      endpoint: process.env.NEXT_PUBLIC_R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.NEXT_PUBLIC_R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    });

    // バケット名の取得
    const bucketName = process.env.NEXT_PUBLIC_R2_BUCKET_NAME || 'video-processing';

    // PutObjectコマンドの作成
    const putObjectCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentType: 'application/octet-stream',
    });

    // 署名付きURLの生成（有効期限: 1時間）
    const uploadUrl = await getSignedUrl(r2Client, putObjectCommand, {
      expiresIn: 3600,
    });

    // 公開URLの生成
    const publicUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${fileKey}`;

    // レスポンスを返す
    return NextResponse.json({
      uploadUrl,
      fileUrl: publicUrl,
      fileKey,
    });
  } catch (error) {
    console.error('アップロードURL生成エラー:', error);
    return NextResponse.json(
      {
        error: 'アップロードURLの生成に失敗しました',
        details: error instanceof Error ? error.message : '不明なエラー',
      },
      { status: 500 }
    );
  }
}
