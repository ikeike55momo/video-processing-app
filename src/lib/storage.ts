import { S3Client, PutObjectCommand, GetObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// 環境変数の状態をログ出力
console.log('R2環境変数チェック:', {
  hasEndpoint: !!R2_ENDPOINT,
  hasAccessKey: !!R2_ACCESS_KEY_ID,
  hasSecretKey: !!R2_SECRET_ACCESS_KEY,
  hasBucket: !!R2_BUCKET_NAME,
  hasPublicUrl: !!R2_PUBLIC_URL,
  endpointLength: R2_ENDPOINT?.length || 0,
  accessKeyLength: R2_ACCESS_KEY_ID?.length || 0,
  secretKeyLength: R2_SECRET_ACCESS_KEY?.length || 0,
  bucketName: R2_BUCKET_NAME || '',
  publicUrl: R2_PUBLIC_URL || '',
});

// 警告メッセージを表示（エラーではなく）
if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.warn('一部のR2設定が不足しています。S3機能が制限される可能性があります。');
}

// R2はS3互換APIを使用
const s3Client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT || undefined,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || '',
    secretAccessKey: R2_SECRET_ACCESS_KEY || '',
  },
  // ★★★ 修正: forcePathStyle を削除 (Cloudflare R2の推奨設定に合わせる) ★★★
});

// 初期化時にR2設定情報をログ出力
console.log('R2設定:', {
  endpoint: R2_ENDPOINT ? '設定あり' : '未設定',
  accessKeyId: R2_ACCESS_KEY_ID ? '設定あり' : '未設定',
  secretAccessKey: R2_SECRET_ACCESS_KEY ? '設定あり（長さ: ' + (R2_SECRET_ACCESS_KEY?.length || 0) + '）' : '未設定',
  bucketName: R2_BUCKET_NAME || '',
  publicUrl: R2_PUBLIC_URL || '',
  region: 'auto',
  // forcePathStyle: true, // 削除済み
});

/**
 * アップロード用の署名付きURLを生成する
 * @param fileName ファイル名
 * @param contentType コンテンツタイプ（MIMEタイプ）
 * @returns 署名付きURLとメタデータ
 */
export async function generateUploadUrl(fileName: string, contentType: string) {
  // 安全なキーを生成（タイムスタンプとランダム文字列を含む）
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const extension = fileName.split('.').pop();
  const key = `uploads/${timestamp}_${randomString}.${extension}`;
  
  console.log('生成されたキー:', key);
  
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  
  // 1時間有効な署名付きURL
  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  
  // 公開アクセス用URLを構築（R2_PUBLIC_URLが設定されている場合）
  let fileUrl = signedUrl;
  if (R2_PUBLIC_URL) {
    fileUrl = `${R2_PUBLIC_URL}/${key}`;
  }
  
  return {
    url: signedUrl,
    key: key,
    bucket: R2_BUCKET_NAME,
    fileUrl: fileUrl
  };
}

/**
 * ファイルサイズに基づいて適切なアップロード方法を決定
 * @param fileName ファイル名
 * @param contentType コンテンツタイプ
 * @param fileSize ファイルサイズ
 * @returns アップロードURL情報
 */
export async function generateAppropriateUploadUrl(fileName: string, contentType: string, fileSize: number) {
  // 大きいファイルはマルチパートアップロードを使用（より小さいファイルでも分割することで信頼性向上）
  const MULTIPART_THRESHOLD = 1024 * 1024 * 1024; // 1GB

  // 3GBを超えるファイルは常にマルチパートアップロードを使用
  const FORCE_MULTIPART_THRESHOLD = 3 * 1024 * 1024 * 1024; // 3GB

  console.log(`ファイルサイズ: ${fileSize} バイト (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`);

  if (fileSize > FORCE_MULTIPART_THRESHOLD) {
    console.log(`3GBを超えるファイルのため、強制的にマルチパートアップロードを使用します`);
    return await generateMultipartUploadUrls(fileName, contentType, fileSize);
  } else if (fileSize > MULTIPART_THRESHOLD) {
    console.log(`1GBを超えるファイルのため、マルチパートアップロードを使用します`);
    return await generateMultipartUploadUrls(fileName, contentType, fileSize);
  } else {
    console.log(`通常のアップロードを使用します`);
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
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = fileName.split('.').pop();
    const key = `uploads/${timestamp}_${randomString}.${extension}`;
    
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

        const signedUrl = await getSignedUrl(s3Client, uploadPartCommand, { expiresIn: 24 * 3600 }); // 24時間有効
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

      const completeUrl = await getSignedUrl(s3Client, completeCommand, { expiresIn: 24 * 3600 }); // 24時間有効
      const abortUrl = await getSignedUrl(s3Client, abortCommand, { expiresIn: 24 * 3600 }); // 24時間有効
      
      // 公開アクセス用URLを使用してファイルURLを構築
      let fileUrl = '';
      if (R2_PUBLIC_URL) {
        fileUrl = `${R2_PUBLIC_URL}/${key}`;
      }
      
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
        fileUrl,
        url: partUrls[0]?.url || '' // 互換性のために最初のパートのURLを返す
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
  // URLの場合は、パスだけを抽出
  let fileKey = key;
  if (key.startsWith('http')) {
    try {
      const url = new URL(key);
      // パスの先頭の/を削除
      fileKey = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
      console.log(`URLからファイルキーを抽出しました: ${fileKey}`, { originalKey: key, extractedKeyLength: fileKey.length });
    } catch (error) {
      console.warn(`URLの解析に失敗しました: ${key}`, error);
    }
  }

  console.log(`getFileContents関数を呼び出します。fileKey: ${fileKey}`, { keyLength: fileKey.length });

  // ★★★ 修正: デコード処理を削除し、元のキーを使用 ★★★
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: fileKey // ★★★ 修正: 元のエンコードされたキーを使用 ★★★
  });

  try {
    const response = await s3Client.send(command);
    if (!response.Body) {
      throw new Error("File not found or empty");
    }

    // StreamをBufferに変換
    return await streamToBuffer(response.Body);
  } catch (error) {
    console.error(`getFileContents関数でエラーが発生しました: ${error}`);
    
    // 公開URLからのダウンロードを試みる
    if (R2_PUBLIC_URL) {
      console.log(`R2からのダウンロードに失敗しました。公開URLを試みます: ${error}`);
      // ★★★ 修正: 公開URLの構築には元のエンコードされたキーを使用 ★★★
      const publicUrl = `${R2_PUBLIC_URL}/${fileKey}`; 
      console.log(`公開URLを使用してファイルにアクセスします: ${publicUrl}`);
      
      try {
        const response = await fetch(publicUrl);
        if (!response.ok) {
          throw new Error(`公開URLからのダウンロードに失敗しました: ${response.status} ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (fetchError) {
        console.error(`公開URLからのダウンロードにも失敗しました: ${fetchError}`);
        throw fetchError;
      }
    }
    
    throw error;
  }
}

/**
 * ストリームをバッファに変換する
 * @param stream 
 * @returns バッファ
 */
/**
 * ストリームをファイルに直接書き込む関数
 * @param key R2のキー
 * @param filePath 書き込み先のファイルパス
 * @returns 成功時はtrue
 */
export async function streamToFile(key: string, filePath: string): Promise<boolean> {
  let fileKey = key;
  if (key.startsWith('http')) {
    try {
      const url = new URL(key);
      fileKey = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
    } catch (error) {
      console.warn(`URLの解析に失敗しました: ${key}`, error);
    }
  }

  console.log(`streamToFile関数を呼び出します。fileKey: ${fileKey}`, { keyLength: fileKey.length });

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: fileKey
  });

  try {
    const response = await s3Client.send(command);
    if (!response.Body) {
      throw new Error("File not found or empty");
    }

    // ストリームを直接ファイルに書き込む
    const writeStream = fs.createWriteStream(filePath);
    const readStream = response.Body as any;

    return new Promise((resolve, reject) => {
      readStream.pipe(writeStream);
      readStream.on('error', (err: Error) => {
        writeStream.end();
        reject(err);
      });
      writeStream.on('finish', () => {
        resolve(true);
      });
      writeStream.on('error', (err: Error) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error(`streamToFile関数でエラーが発生しました: ${error}`);

    // 公開URLからのダウンロードを試みる
    if (R2_PUBLIC_URL) {
      console.log(`R2からのダウンロードに失敗しました。公開URLを試みます: ${error}`);
      const publicUrl = `${R2_PUBLIC_URL}/${fileKey}`;
      console.log(`公開URLを使用してファイルにアクセスします: ${publicUrl}`);

      try {
        const response = await fetch(publicUrl);
        if (!response.ok) {
          throw new Error(`公開URLからのダウンロードに失敗しました: ${response.status} ${response.statusText}`);
        }

        const writeStream = fs.createWriteStream(filePath);
        const readStream = response.body as any;
        
        if (!readStream) {
          throw new Error("Response body is null");
        }

        return new Promise((resolve, reject) => {
          readStream.pipe(writeStream);
          readStream.on('error', (err: Error) => {
            writeStream.end();
            reject(err);
          });
          writeStream.on('finish', () => {
            resolve(true);
          });
          writeStream.on('error', (err: Error) => {
            reject(err);
          });
        });
      } catch (fetchError) {
        console.error(`公開URLからのダウンロードにも失敗しました: ${fetchError}`);
        throw fetchError;
      }
    }

    throw error;
  }
}

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
