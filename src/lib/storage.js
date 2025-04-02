"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateUploadUrl = generateUploadUrl;
exports.getDownloadUrl = getDownloadUrl;
exports.getFileContents = getFileContents;
exports.uploadFile = uploadFile;
exports.uploadBuffer = uploadBuffer;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const fs = __importStar(require("fs"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();

// 環境変数のデバッグ出力
console.log('R2環境変数チェック:', {
    hasEndpoint: !!process.env.R2_ENDPOINT,
    hasAccessKey: !!process.env.R2_ACCESS_KEY_ID,
    hasSecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
    hasBucket: !!process.env.R2_BUCKET_NAME,
    endpointValue: process.env.R2_ENDPOINT,
    bucketValue: process.env.R2_BUCKET_NAME
});

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    console.error('Missing R2 configuration. Please check your .env file.');
}
// R2はS3互換APIを使用
const s3Client = new client_s3_1.S3Client({
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
function generateUploadUrl(fileName, contentType) {
    return __awaiter(this, void 0, void 0, function* () {
        const key = `uploads/${Date.now()}-${fileName}`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            ContentType: contentType,
        });
        // 1時間有効な署名付きURL
        const signedUrl = yield (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, { expiresIn: 3600 });
        return {
            url: signedUrl,
            key: key,
            bucket: R2_BUCKET_NAME,
        };
    });
}
/**
 * ダウンロード用の署名付きURLを生成する
 * @param key ファイルのキー
 * @returns 署名付きURL
 */
function getDownloadUrl(key) {
    return __awaiter(this, void 0, void 0, function* () {
        const command = new client_s3_1.GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
        });
        // 1時間有効な署名付きURL
        return yield (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, { expiresIn: 3600 });
    });
}
/**
 * ファイルの内容を取得する
 * @param key ファイルのキー
 * @returns ファイルの内容（Buffer）
 */
function getFileContents(key) {
    return __awaiter(this, void 0, void 0, function* () {
        const command = new client_s3_1.GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
        });
        const response = yield s3Client.send(command);
        if (!response.Body) {
            throw new Error("File not found or empty");
        }
        // StreamをBufferに変換
        return yield streamToBuffer(response.Body);
    });
}
/**
 * ストリームをバッファに変換する
 * @param stream
 * @returns バッファ
 */
function streamToBuffer(stream) {
    return __awaiter(this, void 0, void 0, function* () {
        const chunks = [];
        return new Promise((resolve, reject) => {
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('error', (err) => reject(err));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
    });
}
/**
 * ファイルをR2に直接アップロードする
 * @param filePath ローカルファイルパス
 * @param key ファイルキー（未指定の場合は自動生成）
 * @param contentType コンテンツタイプ
 * @returns アップロードしたファイルのキー
 */
function uploadFile(filePath, key, contentType) {
    return __awaiter(this, void 0, void 0, function* () {
        const fileContent = fs.readFileSync(filePath);
        const fileKey = key || `uploads/${Date.now()}-${filePath.split('/').pop()}`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: fileKey,
            Body: fileContent,
            ContentType: contentType,
        });
        yield s3Client.send(command);
        return fileKey;
    });
}
/**
 * バッファをR2に直接アップロードする
 * @param buffer アップロードするバッファ
 * @param key ファイルキー
 * @param contentType コンテンツタイプ
 * @returns アップロードしたファイルのキー
 */
function uploadBuffer(buffer, key, contentType) {
    return __awaiter(this, void 0, void 0, function* () {
        const command = new client_s3_1.PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        });
        yield s3Client.send(command);
        return key;
    });
}
