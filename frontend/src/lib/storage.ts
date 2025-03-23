import { S3Client, PutObjectCommand, GetObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

// 環境変数のチェック（サーバーサイドでのみ実行）
if (typeof window === 'undefined' && (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME)) {
  console.error('Missing R2 configuration. Please check your .env file.');
}

// R2はS3互換APIを利用するため、S3Clientを設定します
const s3Client = new S3Client({
  region: "ap-southeast-1",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || '',
    secretAccessKey: R2_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: true, // パススタイルのURLを強制
});

// R2設定のデバッグログ
console.log('R2設定:', {
  endpoint: R2_ENDPOINT,
  bucket: R2_BUCKET_NAME,
  // 機密情報なので完全には表示しない
  accessKeyIdPrefix: R2_ACCESS_KEY_ID ? R2_ACCESS_KEY_ID.substring(0, 5) + '...' : undefined,
  secretKeyExists: !!R2_SECRET_ACCESS_KEY,
  region: "ap-southeast-1",
  forcePathStyle: true
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
  // この関数はサーバーサイドでのみ使用可能です
  if (typeof window !== 'undefined') {
    throw new Error('getFileContents関数はサーバーサイドでのみ使用可能です');
  }

  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);
    
    if (!response.Body) {
      throw new Error('ファイルの内容が空です');
    }
    
    // ダミーの実装（クライアントサイドビルド用）
    return Buffer.from('dummy-content');
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
export async function streamToBuffer(stream: any): Promise<Buffer> {
  // この関数はサーバーサイドでのみ使用可能です
  if (typeof window !== 'undefined') {
    throw new Error('streamToBuffer関数はサーバーサイドでのみ使用可能です');
  }

  // ダミーの実装（クライアントサイドビルド用）
  return Buffer.from('dummy-content');
}

/**
 * ファイルをR2に直接アップロードする
 * @param filePath ローカルファイルパス
 * @param key ファイルキー（未指定の場合は自動生成）
 * @param contentType コンテンツタイプ
 * @returns アップロードしたファイルのキー
 */
export async function uploadFile(filePath: string, key?: string, contentType?: string): Promise<string> {
  // この関数はサーバーサイドでのみ使用可能です
  if (typeof window !== 'undefined') {
    throw new Error('uploadFile関数はサーバーサイドでのみ使用可能です');
  }

  try {
    // サーバーサイドでの実装
    // Note: fsモジュールを使用せずに実装
    // 実際にサーバーサイドで使用する場合は、APIルート内で実装する必要があります
    const fileKey = key || `uploads/${Date.now()}-${filePath.split('/').pop()}`;
    
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: fileKey,
      Body: 'dummy-content', // クライアントサイドビルド用のダミー値
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
    console.log('マルチパートアップロード開始:', { 
      fileName, 
      contentType, 
      fileSize,
      bucket: R2_BUCKET_NAME
    });
    
    const key = `uploads/${Date.now()}-${fileName}`;
    console.log('生成されたキー:', key);
    
    // マルチパートアップロードの開始
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });
    
    console.log('マルチパートアップロードコマンド作成:', {
      bucket: R2_BUCKET_NAME,
      key,
      contentType
    });
    
    let uploadId: string;
    try {
      const response = await s3Client.send(createCommand);
      console.log('アップロードID取得成功:', response.UploadId);
      
      if (!response.UploadId) {
        console.error('UploadIdが取得できませんでした');
        throw new Error('マルチパートアップロードの初期化に失敗しました');
      }
      
      uploadId = response.UploadId;
    } catch (error) {
      console.error('マルチパートアップロードの初期化に失敗しました:', error);
      throw error;
    }
    
    // パートサイズの最適化（ファイルサイズに基づいて調整）
    // Cloudflare R2の制限: 最小パートサイズ5MB、最大10,000パート
    const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB
    const MAX_PARTS = 10000;
    
    // 最適なパートサイズを計算（最小5MB、最大ファイルサイズ/10000）
    let partSize = Math.max(MIN_PART_SIZE, Math.ceil(fileSize / MAX_PARTS));
    
    // パートサイズを5MBの倍数に調整
    partSize = Math.ceil(partSize / MIN_PART_SIZE) * MIN_PART_SIZE;
    
    console.log('パートサイズ計算:', {
      fileSize,
      partSize,
      estimatedParts: Math.ceil(fileSize / partSize)
    });
    
    // 必要なパート数を計算
    const partCount = Math.ceil(fileSize / partSize);
    
    // 各パートのアップロードURLを生成
    const partUrls = [];
    
    for (let i = 1; i <= partCount; i++) {
      const uploadPartCommand = new UploadPartCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        PartNumber: i,
      });
      
      const signedUrl = await getSignedUrl(s3Client, uploadPartCommand, { expiresIn: 3600 });
      partUrls.push({
        url: signedUrl,
        partNumber: i
      });
    }
    
    console.log(`${partCount}個のパートURLを生成しました`);
    
    // 完了と中止用のコマンドを作成
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: [] // クライアント側で各パートのETagを追加
      }
    });
    
    const abortCommand = new AbortMultipartUploadCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
    });
    
    // 完了と中止用のURLを生成
    const completeUrl = await getSignedUrl(s3Client, completeCommand, { expiresIn: 24 * 3600 });
    const abortUrl = await getSignedUrl(s3Client, abortCommand, { expiresIn: 24 * 3600 });
    
    return {
      isMultipart: true,
      key,
      bucket: R2_BUCKET_NAME,
      uploadId,
      partUrls,
      completeUrl,
      abortUrl,
      partSize,
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
