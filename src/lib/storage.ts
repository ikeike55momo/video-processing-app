import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error('Missing R2 configuration. Please check your .env file.');
}

// R2はS3互換APIを使用
const s3Client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || '',
    secretAccessKey: R2_SECRET_ACCESS_KEY || '',
  },
  // forcePathStyleをfalseに設定（CloudflareのR2ではこちらが推奨）
  forcePathStyle: false,
});

// 初期化時にR2設定情報をログ出力
console.log('R2設定情報:', {
  endpoint: R2_ENDPOINT ? '設定あり' : '未設定',
  accessKeyId: R2_ACCESS_KEY_ID ? '設定あり' : '未設定',
  secretAccessKey: R2_SECRET_ACCESS_KEY ? '設定あり（長さ: ' + (R2_SECRET_ACCESS_KEY?.length || 0) + '）' : '未設定',
  bucketName: R2_BUCKET_NAME,
  region: 'auto',
});

/**
 * アップロード用の署名付きURLを生成する
 * @param fileName ファイル名
 * @param contentType コンテンツタイプ（MIMEタイプ）
 * @returns 署名付きURLとメタデータ
 */
export async function generateUploadUrl(fileName: string, contentType: string) {
  const key = `uploads/${Date.now()}-${fileName}`;
  
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  
  // 1時間有効な署名付きURL
  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  
  return {
    url: signedUrl,
    key: key,
    bucket: R2_BUCKET_NAME,
  };
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
