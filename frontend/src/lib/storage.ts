import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as fs from 'fs';

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

// 環境変数のチェック
if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error('Missing R2 configuration. Please check your .env file.');
}

// R2はS3互換APIを利用するため、S3Clientを設定します
const s3Client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || '',
    secretAccessKey: R2_SECRET_ACCESS_KEY || '',
  },
});

/**
 * ファイル名とコンテンツタイプを指定して、署名付きアップロードURLを生成します。
 * 生成されたURLは1時間有効です。
 */
export async function generateUploadUrl(fileName: string, contentType: string) {
  try {
    const key = `uploads/${Date.now()}-${fileName}`;
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { url: signedUrl, key, bucket: R2_BUCKET_NAME };
  } catch (error) {
    console.error('Error generating upload URL:', error);
    throw error;
  }
}

/**
 * 指定したキーのファイルに対して、署名付きダウンロードURLを生成します。
 * URLは1時間有効です。
 */
export async function getDownloadUrl(key: string) {
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  } catch (error) {
    console.error('Error generating download URL:', error);
    throw error;
  }
}

/**
 * ファイルの内容を取得する
 * @param key ファイルのキー
 * @returns ファイルの内容（Buffer）
 */
export async function getFileContents(key: string): Promise<Buffer> {
  try {
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
  } catch (error) {
    console.error('Error getting file contents:', error);
    throw error;
  }
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
  try {
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
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

/**
 * バッファをR2に直接アップロードする
 * @param buffer アップロードするバッファ
 * @param key ファイルキー
 * @param contentType コンテンツタイプ
 * @returns アップロードしたファイルのキー
 */
export async function uploadBuffer(buffer: Buffer, key: string, contentType?: string): Promise<string> {
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
    
    await s3Client.send(command);
    return key;
  } catch (error) {
    console.error('Error uploading buffer:', error);
    throw error;
  }
}
