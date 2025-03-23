import { S3Client, PutObjectCommand, GetObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
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
    
    // CORSヘッダーを含む署名付きURLを生成
    const signedUrl = await getSignedUrl(s3Client, command, { 
      expiresIn: 3600,
      // 追加のヘッダーを指定
      unhoistableHeaders: new Set(['host']),
    });
    
    return { 
      url: signedUrl, 
      key, 
      bucket: R2_BUCKET_NAME,
      // クライアント側で使用するためのファイルURLを追加
      fileUrl: `uploads/${key}`
    };
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

/**
 * ファイルサイズに基づいて適切なアップロード方法を決定
 * @param fileName ファイル名
 * @param contentType コンテンツタイプ
 * @param fileSize ファイルサイズ
 * @returns アップロードURL情報
 */
export async function generateAppropriateUploadUrl(fileName: string, contentType: string, fileSize: number) {
  // 50MBを超えるファイルはマルチパートアップロードを使用（より小さいファイルでも分割することで信頼性向上）
  const MULTIPART_THRESHOLD = 50 * 1024 * 1024; // 50MB
  
  if (fileSize > MULTIPART_THRESHOLD) {
    return await generateMultipartUploadUrls(fileName, contentType, fileSize);
  } else {
    return await generateUploadUrl(fileName, contentType);
  }
}

/**
 * マルチパートアップロード用のURLを生成
 * @param fileName ファイル名
 * @param contentType コンテンツタイプ
 * @param fileSize ファイルサイズ
 * @returns マルチパートアップロードURL情報
 */
export async function generateMultipartUploadUrls(fileName: string, contentType: string, fileSize: number) {
  try {
    const key = `uploads/${Date.now()}-${fileName}`;
    
    // マルチパートアップロードの開始
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });
    
    const { UploadId } = await s3Client.send(createCommand);
    
    if (!UploadId) {
      throw new Error('マルチパートアップロードの初期化に失敗しました');
    }
    
    // パートサイズの最適化（ファイルサイズに基づいて調整）
    // Cloudflare R2の制限: 最小パートサイズ5MB、最大10,000パート
    const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB（R2の最小パートサイズ）
    const MAX_PARTS = 10000; // R2の最大パート数
    
    // ファイルサイズに基づいて最適なパートサイズを計算
    // 目標: パート数を減らしつつ、各パートが大きすぎないようにする
    let partSize = 0;
    
    if (fileSize <= 1 * 1024 * 1024 * 1024) { // 1GB以下
      partSize = 10 * 1024 * 1024; // 10MB
    } else if (fileSize <= 10 * 1024 * 1024 * 1024) { // 10GB以下
      partSize = 50 * 1024 * 1024; // 50MB
    } else if (fileSize <= 50 * 1024 * 1024 * 1024) { // 50GB以下
      partSize = 100 * 1024 * 1024; // 100MB
    } else { // 50GB超
      // 最大パート数に収まるように最小パートサイズを計算
      partSize = Math.max(MIN_PART_SIZE, Math.ceil(fileSize / MAX_PARTS));
    }
    
    // パート数の計算
    const partCount = Math.ceil(fileSize / partSize);
    
    // 最大10000パートまで
    if (partCount > MAX_PARTS) {
      throw new Error(`ファイルが大きすぎます（最大${MAX_PARTS}パート）。Cloudflareのプランアップグレードが必要かもしれません。`);
    }
    
    console.log(`マルチパートアップロード設定: ファイルサイズ=${fileSize}バイト, パートサイズ=${partSize}バイト, パート数=${partCount}`);
    
    // 各パートの署名付きURLを生成
    const partUrls = [];
    
    for (let i = 1; i <= partCount; i++) {
      const uploadPartCommand = new UploadPartCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        UploadId,
        PartNumber: i,
      });
      
      const signedUrl = await getSignedUrl(s3Client, uploadPartCommand, { 
        expiresIn: 12 * 3600, // 12時間（大きなファイルのアップロードに十分な時間）
        unhoistableHeaders: new Set(['host']),
      });
      
      partUrls.push({
        url: signedUrl,
        partNumber: i,
      });
    }
    
    // 完了用のコマンドを準備
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      UploadId,
      MultipartUpload: {
        Parts: [] // クライアント側で各パートのETagを追加
      }
    });
    
    // 中止用のコマンドを準備
    const abortCommand = new AbortMultipartUploadCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      UploadId,
    });
    
    // 完了と中止用のURLを生成
    const completeUrl = await getSignedUrl(s3Client, completeCommand, { 
      expiresIn: 24 * 3600, // 24時間（大きなファイルのアップロードに十分な時間）
      unhoistableHeaders: new Set(['host']),
    });
    
    const abortUrl = await getSignedUrl(s3Client, abortCommand, { 
      expiresIn: 24 * 3600, // 24時間
      unhoistableHeaders: new Set(['host']),
    });
    
    return {
      isMultipart: true,
      key,
      bucket: R2_BUCKET_NAME,
      uploadId: UploadId,
      partUrls,
      completeUrl,
      abortUrl,
      partSize: partSize,
      fileUrl: `uploads/${key}`
    };
  } catch (error) {
    console.error('マルチパートアップロードURL生成エラー:', error);
    throw error;
  }
}

/**
 * クライアント側でマルチパートアップロードを実行する関数
 * @param file アップロードするファイル
 * @param multipartData マルチパートアップロード情報
 * @param progressCallback 進捗コールバック関数
 * @returns アップロード結果
 */
export async function uploadMultipart(
  file: File, 
  multipartData: {
    isMultipart: boolean;
    key: string;
    bucket: string;
    uploadId: string;
    partUrls: { url: string; partNumber: number }[];
    completeUrl: string;
    abortUrl: string;
    partSize: number;
    fileUrl: string;
  },
  progressCallback?: (progress: number) => void
) {
  try {
    const { partUrls, completeUrl, partSize } = multipartData;
    const totalParts = partUrls.length;
    const parts: { ETag: string; PartNumber: number }[] = [];
    let uploadedParts = 0;

    // 各パートをアップロード
    for (let i = 0; i < totalParts; i++) {
      const { url, partNumber } = partUrls[i];
      
      // ファイルの該当部分を切り出し
      const start = i * partSize;
      const end = Math.min(start + partSize, file.size);
      const chunk = file.slice(start, end);
      
      // パートをアップロード
      const etag = await uploadPart(url, chunk);
      
      // 結果を保存
      parts.push({
        ETag: etag,
        PartNumber: partNumber
      });
      
      // 進捗を更新
      uploadedParts++;
      if (progressCallback) {
        progressCallback(Math.round((uploadedParts / totalParts) * 100));
      }
    }
    
    // パートをETagの順にソート
    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    
    // マルチパートアップロードを完了
    await completeMultipartUpload(completeUrl, parts);
    
    return {
      success: true,
      key: multipartData.key,
      fileUrl: multipartData.fileUrl
    };
  } catch (error) {
    console.error('マルチパートアップロードエラー:', error);
    
    // エラー時はアップロードを中止
    try {
      await fetch(multipartData.abortUrl, {
        method: 'DELETE'
      });
      console.log('マルチパートアップロードを中止しました');
    } catch (abortError) {
      console.error('アップロード中止エラー:', abortError);
    }
    
    throw error;
  }
}

/**
 * 単一パートをアップロードする関数
 * @param url 署名付きURL
 * @param chunk ファイルチャンク
 * @returns ETag
 */
async function uploadPart(url: string, chunk: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.withCredentials = false;
    
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // ETagヘッダーを取得（引用符を含む）
        const etag = xhr.getResponseHeader('ETag');
        if (!etag) {
          reject(new Error('ETagが見つかりません'));
          return;
        }
        resolve(etag);
      } else {
        reject(new Error(`パートアップロード失敗: ${xhr.status} ${xhr.statusText}`));
      }
    };
    
    xhr.onerror = () => {
      reject(new Error('パートアップロード中にネットワークエラーが発生しました'));
    };
    
    xhr.send(chunk);
  });
}

/**
 * マルチパートアップロードを完了する関数
 * @param url 完了用の署名付きURL
 * @param parts パート情報の配列
 */
async function completeMultipartUpload(url: string, parts: { ETag: string; PartNumber: number }[]): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml'
    },
    body: generateCompleteMultipartBody(parts)
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`マルチパートアップロード完了失敗: ${response.status} ${response.statusText} - ${text}`);
  }
}

/**
 * CompleteMultipartUploadリクエスト用のXMLボディを生成
 * @param parts パート情報の配列
 * @returns XMLボディ
 */
function generateCompleteMultipartBody(parts: { ETag: string; PartNumber: number }[]): string {
  let xml = '<CompleteMultipartUpload>';
  
  for (const part of parts) {
    xml += `<Part>`;
    xml += `<PartNumber>${part.PartNumber}</PartNumber>`;
    xml += `<ETag>${part.ETag}</ETag>`;
    xml += `</Part>`;
  }
  
  xml += '</CompleteMultipartUpload>';
  return xml;
}
