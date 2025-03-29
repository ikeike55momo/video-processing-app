import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-70c06e6cdf134c4ea4d0adf14d3a6b16.r2.dev';

// 環境変数のチェックと詳細なログ出力
if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error('Missing R2 configuration. Please check your .env file.');
  console.error(`R2_ENDPOINT: ${R2_ENDPOINT ? 'Set' : 'Not set'}`);
  console.error(`R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID ? 'Set' : 'Not set'}`);
  console.error(`R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY ? 'Set (value hidden)' : 'Not set'}`);
  console.error(`R2_BUCKET_NAME: ${R2_BUCKET_NAME ? 'Set' : 'Not set'}`);
  console.error(`R2_PUBLIC_URL: ${R2_PUBLIC_URL ? 'Set' : 'Not set'}`);
}

// R2はS3互換APIを使用
const s3Client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || '',
    secretAccessKey: R2_SECRET_ACCESS_KEY || '',
  },
});

/**
 * アップロード用の署名付きURLを生成する
 * @param fileName ファイル名
 * @param contentType コンテンツタイプ（MIMEタイプ）
 * @returns 署名付きURLとメタデータ
 */
export async function generateUploadUrl(fileName: string, contentType: string) {
  try {
    // 環境変数が設定されているか確認
    if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
      throw new Error('R2 configuration is missing. Cannot generate upload URL.');
    }

    console.log("R2環境変数:", {
      endpoint: R2_ENDPOINT,
      region: "auto",
      publicUrl: R2_PUBLIC_URL,
      bucketName: R2_BUCKET_NAME,
    });

    console.log(`Generating upload URL for file: ${fileName} (${contentType})`);
    console.log('R2環境変数:', {
      endpoint: R2_ENDPOINT ? R2_ENDPOINT.substring(0, 20) + '...' : 'Not set',
      accessKey: R2_ACCESS_KEY_ID ? R2_ACCESS_KEY_ID.substring(0, 5) + '...' : 'Not set',
      secretKey: R2_SECRET_ACCESS_KEY ? 'Set (hidden)' : 'Not set',
      bucket: R2_BUCKET_NAME || 'Not set',
      publicUrl: R2_PUBLIC_URL || 'Not set'
    });
    
    const key = `uploads/${Date.now()}-${fileName}`;
    
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });
    
    // 1時間有効な署名付きURL
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    console.log(`生成された署名付きURL: ${signedUrl.substring(0, 30)}...`);
    
    // 公開URLを生成（R2_PUBLIC_URLが設定されている場合）
    let publicUrl = null;
    if (R2_PUBLIC_URL) {
      publicUrl = `${R2_PUBLIC_URL}/${key}`;
      console.log(`構築された公開URL: ${publicUrl.substring(0, 30)}...`);
    } else {
      console.log("R2_PUBLIC_URLが設定されていないため、公開URLは生成されません");
    }

    console.log(`Generated upload URL: ${signedUrl.substring(0, 50)}...`);
    console.log(`File key: ${key}`);
    
    // 必ず有効なURLを返すようにする
    // publicUrlがundefinedやnullの場合は、signedUrlをフォールバックとして使用
    const safePublicUrl = publicUrl || signedUrl;
    
    const result = {
      url: signedUrl,
      publicUrl: safePublicUrl, // 必ず有効な値を返す
      key: key,
      bucket: R2_BUCKET_NAME,
    };
    
    console.log("generateUploadUrl結果:", JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error generating upload URL:', error);
    throw error;
  }
}

/**
 * ダウンロード用の署名付きURLを生成する
 * @param key ファイルのキー
 * @returns 署名付きURL
 */
export async function getDownloadUrl(key: string) {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });
  
  // 1時間有効な署名付きURL
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

/**
 * ファイルの内容を取得する
 * @param key ファイルのキー
 * @returns ファイルの内容（Buffer）
 */
export async function getFileContents(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });
  
  const response = await s3Client.send(command);
  if (!response.Body) {
    throw new Error("File not found or empty");
  }
  
  // StreamをBufferに変換
  return await streamToBuffer(response.Body);
}

/**
 * ストリームをバッファに変換する
 * @param stream 
 * @returns バッファ
 */
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err: Error) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * ファイルをR2に直接アップロードする
 * @param filePath ローカルファイルパス
 * @param key ファイルキー（未指定の場合は自動生成）
 * @param contentType コンテンツタイプ
 * @returns アップロードしたファイルのキー
 */
export async function uploadFile(filePath: string, key?: string, contentType?: string): Promise<string> {
  const fileContent = fs.readFileSync(filePath);
  const fileKey = key || `uploads/${Date.now()}-${filePath.split('/').pop()}`;
  
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: fileKey,
    Body: fileContent,
    ContentType: contentType,
  });
  
  await s3Client.send(command);
  return fileKey;
}

/**
 * バッファをR2に直接アップロードする
 * @param buffer アップロードするバッファ
 * @param key ファイルキー
 * @param contentType コンテンツタイプ
 * @returns アップロードしたファイルのキー
 */
export async function uploadBuffer(buffer: Buffer, key: string, contentType?: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  
  await s3Client.send(command);
  return key;
}
