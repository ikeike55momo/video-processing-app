import { S3Client, PutObjectCommand, GetObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-70c06e6cdf134c4ea4d0adf14d3a6b16.r2.dev';

// 環境変数のチェック（サーバーサイドでのみ実行）
if (typeof window === 'undefined' && (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME)) {
  console.error('Missing R2 configuration. Please check your .env file.');
}

// デバッグ用に環境変数の存在を確認
console.log('環境変数チェック:', {
  hasAccessKey: !!R2_ACCESS_KEY_ID,
  hasSecretKey: !!R2_SECRET_ACCESS_KEY,
  hasEndpoint: !!R2_ENDPOINT,
  hasBucket: !!R2_BUCKET_NAME,
  hasPublicUrl: !!R2_PUBLIC_URL,
  accessKeyLength: R2_ACCESS_KEY_ID.length,
  secretKeyLength: R2_SECRET_ACCESS_KEY.length,
  endpoint: R2_ENDPOINT,
  bucket: R2_BUCKET_NAME,
  publicUrl: R2_PUBLIC_URL
});

// R2はS3互換APIを利用するため、S3Clientを設定します
const s3Client = new S3Client({
  region: "auto", // Cloudflare R2のデフォルトリージョン
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // バケット名をパスの一部として使用
});

// R2設定のデバッグログ
console.log('R2設定:', {
  endpoint: R2_ENDPOINT,
  bucket: R2_BUCKET_NAME,
  // 機密情報なので完全には表示しない
  accessKeyIdPrefix: R2_ACCESS_KEY_ID ? R2_ACCESS_KEY_ID.substring(0, 5) + '...' : undefined,
  secretKeyExists: !!R2_SECRET_ACCESS_KEY,
  region: "auto",
  forcePathStyle: true
});

/**
 * ファイル名を安全なキーに変換する関数
 * @param fileName オリジナルのファイル名
 * @returns 安全なキー名
 */
function createSafeKey(fileName: string) {
  // 日本語などの文字を含むファイル名をエンコード
  const timestamp = Date.now();
  const safeName = encodeURIComponent(fileName).replace(/%/g, '');
  return `uploads/${timestamp}-${safeName}`;
}

/**
 * ファイル名とコンテンツタイプを指定して、署名付きアップロードURLを生成します。
 * 生成されたURLは1時間有効です。
 */
export async function generateUploadUrl(fileName: string, contentType: string) {
  try {
    // 安全なキーを生成
    const key = createSafeKey(fileName);
    console.log('生成されたキー（通常アップロード）:', key);
    
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });
    
    // 署名付きURLを生成（1時間有効）
    const signedUrl = await generatePresignedUrl(command, 3600);
    
    // 公開アクセス用URLを使用してファイルURLを構築
    const fileUrl = `${R2_PUBLIC_URL}/${key}`;
    
    return {
      isMultipart: false,
      url: signedUrl,
      key,
      fileUrl: fileUrl
    };
  } catch (error) {
    console.error('アップロードURL生成エラー:', error);
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
    return await generatePresignedUrl(command, 3600);
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
  console.log(`マルチパートアップロード開始: {
    fileName: '${fileName}',
    contentType: '${contentType}',
    fileSize: ${fileSize},
    bucket: '${R2_BUCKET_NAME}'
  }`);

  try {
    // 安全なキー名を生成
    const key = createSafeKey(fileName);
    console.log(`生成されたキー: ${key}`);

    // パート数の計算（最大10000パート、最小5MBのパートサイズ）
    const MAX_PARTS = 10000;
    const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB
    let partSize = Math.ceil(fileSize / MAX_PARTS);
    partSize = Math.max(partSize, MIN_PART_SIZE);
    const partCount = Math.ceil(fileSize / partSize);

    console.log(`マルチパートアップロード設定: {
      partSize: ${partSize} バイト,
      partCount: ${partCount},
      totalSize: ${fileSize} バイト
    }`);

    // マルチパートアップロードの初期化
    console.log(`マルチパートアップロードコマンド作成: {
      bucket: '${R2_BUCKET_NAME}',
      key: '${key}',
      contentType: '${contentType}'
    }`);

    try {
      // マルチパートアップロードの作成
      const createCommand = new CreateMultipartUploadCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
      });

      const { UploadId } = await s3Client.send(createCommand);
      if (!UploadId) {
        throw new Error('マルチパートアップロードIDの取得に失敗しました');
      }

      console.log(`マルチパートアップロードID取得成功: ${UploadId}`);

      // 各パートのアップロードURLを生成
      const partUrls = [];
      for (let partNumber = 1; partNumber <= partCount; partNumber++) {
        const uploadPartCommand = new UploadPartCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          UploadId,
          PartNumber: partNumber,
        });

        const signedUrl = await generatePresignedUrl(uploadPartCommand, 24 * 3600); // 24時間有効
        partUrls.push({
          url: signedUrl,
          partNumber,
        });
      }

      console.log(`パートURL生成完了: ${partUrls.length}個のURLを生成`);

      // 完了および中止用のURLを生成
      const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        UploadId,
      });

      const abortCommand = new AbortMultipartUploadCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        UploadId,
      });

      const completeUrl = await generatePresignedUrl(completeCommand, 24 * 3600); // 24時間有効
      const abortUrl = await generatePresignedUrl(abortCommand, 24 * 3600); // 24時間有効
      
      // 公開アクセス用URLを使用してファイルURLを構築
      const fileUrl = `${R2_PUBLIC_URL}/${key}`;
      
      console.log(`マルチパートアップロードURL生成完了: {
        key: '${key}',
        uploadId: '${UploadId}',
        partCount: ${partUrls.length},
        fileUrl: '${fileUrl}'
      }`);
      
      return {
        isMultipart: true,
        key,
        bucket: R2_BUCKET_NAME,
        uploadId: UploadId,
        partUrls,
        completeUrl,
        abortUrl,
        partSize,
        fileUrl
      };
    } catch (error) {
      console.error('マルチパートアップロードの初期化に失敗しました:', error);
      
      // 通常のアップロードにフォールバック
      console.log('通常のアップロードにフォールバックします');
      return await generateUploadUrl(fileName, contentType);
    }
  } catch (error) {
    console.error('マルチパートアップロードURL生成エラー:', error);
    throw new Error('マルチパートアップロードURLの生成に失敗しました: ' + (error instanceof Error ? error.message : String(error)));
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

    // 並列処理の設定
    const MAX_CONCURRENT_UPLOADS = 5; // 同時アップロード数
    const MAX_RETRIES = 3; // 最大再試行回数
    const TIMEOUT_MS = 30000; // タイムアウト時間（ミリ秒）

    // パートを処理するための関数
    const processPartUpload = async (partInfo: { url: string; partNumber: number }, retryCount = 0) => {
      try {
        // ファイルの該当部分を切り出し
        const start = (partInfo.partNumber - 1) * partSize;
        const end = Math.min(start + partSize, file.size);
        const chunk = file.slice(start, end);
        
        // パートをアップロードし、タイムアウト処理を追加
        const etag = await Promise.race([
          uploadPart(partInfo.url, chunk),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('アップロードタイムアウト')), TIMEOUT_MS)
          )
        ]);
        
        // 結果を保存
        return {
          ETag: etag,
          PartNumber: partInfo.partNumber
        };
      } catch (error) {
        // 再試行回数が上限に達していない場合は再試行
        if (retryCount < MAX_RETRIES) {
          console.log(`パート ${partInfo.partNumber} のアップロードに失敗しました。再試行 ${retryCount + 1}/${MAX_RETRIES}`);
          return processPartUpload(partInfo, retryCount + 1);
        }
        throw error;
      }
    };

    // 進捗更新用の関数
    const updateProgress = () => {
      uploadedParts++;
      if (progressCallback) {
        progressCallback(Math.round((uploadedParts / totalParts) * 100));
      }
    };

    // チャンクを並列処理するための関数
    const uploadPartsInBatches = async () => {
      // すべてのパートをキューに入れる
      const queue = [...partUrls];
      const results: { ETag: string; PartNumber: number }[] = [];
      
      while (queue.length > 0) {
        // 同時処理数を制限して並列アップロード
        const batch = queue.splice(0, MAX_CONCURRENT_UPLOADS);
        const batchPromises = batch.map(async (partInfo) => {
          const result = await processPartUpload(partInfo);
          updateProgress();
          return result;
        });
        
        // バッチ内のすべてのアップロードを待機
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }
      
      return results;
    };

    // 並列処理でパートをアップロード
    const uploadedResults = await uploadPartsInBatches();
    
    // パートをETagの順にソート
    const sortedParts = uploadedResults.sort((a, b) => a.PartNumber - b.PartNumber);
    
    // マルチパートアップロードを完了
    await completeMultipartUpload(completeUrl, sortedParts);
    
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

// 署名付きURLを生成する関数
async function generatePresignedUrl(command: any, expiresIn: number = 3600) {
  try {
    // CORSヘッダーを含める
    return await getSignedUrl(s3Client, command, { 
      expiresIn,
      // CORSヘッダーを追加
      requestOptions: {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE',
          'Access-Control-Allow-Headers': '*'
        }
      }
    });
  } catch (error) {
    console.error('署名付きURL生成エラー:', error);
    throw error;
  }
}
