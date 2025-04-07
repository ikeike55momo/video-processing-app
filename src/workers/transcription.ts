import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import { PrismaClient, Status } from '@prisma/client';
import { Job, Worker } from 'bullmq'; // Import Worker from bullmq
import IORedis from 'ioredis'; // ★★★ Import IORedis ★★★
import { queueManager, QUEUE_NAMES, JobData, JobProgress } from '../lib/bull-queue'; // Import from bull-queue
import { getFileContents, getDownloadUrl, streamToFile } from '../lib/storage';
import { execSync } from 'child_process';
import axios from 'axios';

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// キュー名
const QUEUE_NAME = QUEUE_NAMES.TRANSCRIPTION; // Use constant from bull-queue
const SUMMARY_QUEUE = QUEUE_NAMES.SUMMARY; // Use constant from bull-queue

// 一時ファイルディレクトリ
const TMP_DIR = process.env.TMP_DIR || '/tmp';

// 最大ファイルサイズ（バイト単位）- 4MB
const MAX_DIRECT_PROCESS_SIZE = 4 * 1024 * 1024;

// チャンクの最大時間（秒）
const CHUNK_DURATION = 300; // 5分

// --- Helper functions (optimizeAudioForGemini, transcribeAudio, transcribeWithGemini, processAudioInChunks, processLargeFile, extractTimestampsWithGemini, logMemoryUsage) remain the same ---
// (これらの関数の内容は変更なしのため省略)
/**
 * 音声ファイルをGemini APIに最適な形式に変換する
 * @param inputPath 入力ファイルパス
 * @returns 最適化された音声ファイルのパス
 */
async function optimizeAudioForGemini(inputPath: string): Promise<string> {
  const workDir = path.dirname(inputPath);
  const optimizedPath = path.join(workDir, 'optimized.wav');

  console.log(`音声ファイルを最適化: ${inputPath} -> ${optimizedPath}`);

  try {
    // FFmpegを使用して16kHz、モノラル、WAV形式に変換
    execSync(`ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${optimizedPath}" -y`,
      { stdio: 'inherit' });

    return optimizedPath;
  } catch (error) {
    console.error('音声最適化エラー:', error);
    throw new Error(`音声ファイルの最適化に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 音声ファイルの文字起こしを行う
 * @param audioPath 音声ファイルパス
 * @returns 文字起こし結果
 */
async function transcribeAudio(audioPath: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  try {
    // 音声ファイルを最適化
    const optimizedAudioPath = await optimizeAudioForGemini(audioPath);

    // ファイルサイズを確認
    const stats = fs.statSync(optimizedAudioPath);
    console.log(`最適化された音声ファイルサイズ: ${stats.size} バイト`);

    if (stats.size > MAX_DIRECT_PROCESS_SIZE) {
      // 大きなファイルはチャンク処理
      console.log(`ファイルサイズが大きいため、チャンク処理を適用します: ${stats.size} バイト`);
      return await processAudioInChunks(optimizedAudioPath);
    } else {
      // 小さなファイルは直接処理
      console.log(`ファイルを直接処理します: ${stats.size} バイト`);
      return await transcribeWithGemini(optimizedAudioPath);
    }
  } catch (error) {
    console.error('文字起こしエラー:', error);
    throw new Error(`文字起こし処理に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Gemini APIを使用して音声ファイルの文字起こしを行う
 * @param audioPath 音声ファイルパス
 * @returns 文字起こし結果
 */
async function transcribeWithGemini(audioPath: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    // 音声ファイルをBase64エンコード
    const audioData = fs.readFileSync(audioPath);
    const base64Audio = audioData.toString('base64');

    console.log(`Gemini Flashで文字起こしを実行中...`);

    // Gemini APIリクエスト
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `あなたは高精度文字起こしの専門家です。このファイルは実際にユーザーがアップロードした音声または動画データです。
                音声の内容を正確に文字起こししてください。音声が聞き取れない場合は「[聞き取れません]」と記載してください。
                架空のセミナー内容を生成しないでください。実際に聞こえる内容のみを文字起こししてください。
                可能であれば、話者の区別や音声の特徴（間、笑い声、拍手など）も記録してください。
                日本語の音声の場合は日本語で、英語の音声の場合は英語で文字起こしを行ってください。
                音声が聞き取れない場合は、架空の内容を作成せず、正直に「[聞き取れません]」と記載してください。`
              },
              {
                inline_data: {
                  mime_type: 'audio/wav',
                  data: base64Audio
                }
              }
            ]
          }
        ],
        generation_config: {
          temperature: 0.2,
          top_p: 0.95,
          top_k: 0,
          max_output_tokens: 8192,
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        }
      }
    );

    // レスポンスから文字起こし結果を抽出
    const transcription = response.data.candidates[0].content.parts[0].text;

    // 架空のセミナー内容が含まれていないか確認
    if (transcription.includes('架空のセミナー内容') ||
        transcription.includes('実際の音声ファイルがない') ||
        transcription.includes('音声ファイルが提供されていない')) {
      throw new Error('Gemini APIが架空の内容を生成しました。文字起こし結果は信頼できません。');
    }

    return transcription;
  } catch (error) {
    console.error('Gemini API文字起こしエラー:', error);
    throw new Error(`Gemini APIでの文字起こしに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 音声ファイルをチャンクに分割して処理する
 * @param audioPath 音声ファイルパス
 * @returns 結合された文字起こし結果
 */
async function processAudioInChunks(audioPath: string): Promise<string> {
  const workDir = path.dirname(audioPath);
  const chunkDir = path.join(workDir, 'chunks');

  // チャンクディレクトリを作成
  fs.mkdirSync(chunkDir, { recursive: true });

  try {
    // 音声ファイルの長さを取得（秒）
    const durationOutput = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`).toString().trim();
    const duration = parseFloat(durationOutput);

    console.log(`音声ファイルの長さ: ${duration}秒`);

    // チャンク数を計算
    const numChunks = Math.ceil(duration / CHUNK_DURATION);
    console.log(`${numChunks}個のチャンクに分割します（各${CHUNK_DURATION}秒）`);

    const transcriptionParts: string[] = [];

    // 各チャンクを処理
    for (let i = 0; i < numChunks; i++) {
      const startTime = i * CHUNK_DURATION;
      const chunkPath = path.join(chunkDir, `chunk_${i}.wav`);

      // チャンクを抽出
      console.log(`チャンク ${i+1}/${numChunks} を抽出中: ${startTime}秒から ${CHUNK_DURATION}秒間`);
      execSync(`ffmpeg -i "${audioPath}" -ss ${startTime} -t ${CHUNK_DURATION} -c copy "${chunkPath}" -y`,
        { stdio: 'inherit' });

      // チャンクを文字起こし
      console.log(`チャンク ${i+1}/${numChunks} を文字起こし中...`);
      const chunkTranscription = await transcribeWithGemini(chunkPath);
      transcriptionParts.push(chunkTranscription);

      // 処理済みのチャンクを削除
      fs.unlinkSync(chunkPath);
    }

    // すべてのチャンクの結果を結合
    return transcriptionParts.join('\n\n');
  } catch (error) {
    console.error('チャンク処理エラー:', error);
    throw new Error(`音声ファイルのチャンク処理に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // チャンクディレクトリを削除
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('チャンクディレクトリの削除に失敗:', cleanupError);
    }
  }
}

/**
 * 大きなファイルを複数の小さなチャンクに分割して処理する
 * @param filePath ファイルパス
 * @returns 処理結果の配列
 */
async function processLargeFile(filePath: string): Promise<string[]> {
  // 処理開始時のメモリ使用量をログ出力
  console.log('ファイル処理開始時のメモリ使用量:');
  logMemoryUsage();

  // ファイル情報を取得
  const fileStats = fs.statSync(filePath);
  console.log(`ファイル情報: 存在=${fs.existsSync(filePath)}, サイズ=${fileStats.size} バイト`);

  // 一時ディレクトリの作成
  const workDir = path.join(TMP_DIR, `transcription-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // 動画ファイルから音声を抽出
    const audioPath = path.join(workDir, 'audio.mp3');
    console.log(`動画ファイルから音声を抽出: ${filePath} -> ${audioPath}`);

    // FFmpegを使用して音声抽出
    execSync(`ffmpeg -i "${filePath}" -q:a 0 -map a "${audioPath}" -y`, { stdio: 'inherit' });

    // 音声抽出後のメモリ使用量をログ出力
    console.log('音声抽出後のメモリ使用量:');
    logMemoryUsage();

    // 音声ファイルを文字起こし（最適化と必要に応じたチャンク処理を含む）
    const transcription = await transcribeAudio(audioPath);

    // 文字起こし後のメモリ使用量をログ出力
    console.log('文字起こし完了後のメモリ使用量:');
    logMemoryUsage();

    // 一時ファイルの削除
    fs.unlinkSync(audioPath);

    return [transcription];
  } catch (error) {
    console.error('ファイル処理エラー:', error);
    throw error;
  } finally {
    // 一時ディレクトリの削除
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('一時ディレクトリの削除に失敗:', cleanupError);
    }

    // 処理完了時のメモリ使用量をログ出力
    console.log('メモリ使用量（処理完了時）:');
    logMemoryUsage();
  }
}


/**
 * ★★★ 新規追加: Gemini APIを使用して文字起こしテキストからタイムスタンプを抽出する関数 ★★★
 * @param transcriptText 文字起こしテキスト
 * @returns タイムスタンプ情報の配列 (例: [{ timestamp: "00:00:10", text: "..." }]) または null
 */
async function extractTimestampsWithGemini(transcriptText: string): Promise<any[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing for timestamp extraction');
    return null;
  }

  // テキストが短い場合はタイムスタンプ抽出をスキップ (必要に応じて調整)
  if (!transcriptText || transcriptText.length < 10) {
      console.log('Transcript too short, skipping timestamp extraction.');
      return null;
  }

  console.log(`タイムスタンプ抽出処理を開始: テキスト長=${transcriptText.length}文字`);

  try {
    // Gemini API (text-only model might be better, e.g., gemini-pro, but flash might work)
    // プロンプトを調整して、望ましいJSON形式または特定のテキスト形式でタイムスタンプを出力させる
    const prompt = `
以下の文字起こしテキストにタイムスタンプを追加してください。
各発言や重要な区切りに対して、[HH:MM:SS] 形式のタイムスタンプを付与し、JSON配列形式で出力してください。

例:
[
  { "timestamp": "00:00:05", "text": "最初の発言内容..." },
  { "timestamp": "00:00:15", "text": "次の発言内容..." },
  { "timestamp": "00:00:28", "text": "[効果音] 説明..." }
]

重要な指示:
- 必ず上記のJSON配列形式で出力してください。他の形式は受け付けられません。
- タイムスタンプは非常に正確である必要があります。発言の開始時間を正確に反映してください。
- 実際の音声内容に基づいて、各発言の開始時間を2秒程度早めに設定してください。これにより、ユーザーが発言の開始を聞き逃さないようになります。
- 元のテキストの内容は変更しないでください。
- 架空の内容やタイムスタンプを生成しないでください。
- 各発言の区切りを明確にし、適切な間隔でタイムスタンプを付与してください。

文字起こしテキスト:
---
${transcriptText}
---

出力は必ず以下の形式の有効なJSON配列のみにしてください:
[{"timestamp": "HH:MM:SS", "text": "発言内容"}, ...]
`;

console.log('Gemini APIにタイムスタンプ抽出リクエストを送信します...');
const response = await axios.post(
  // ★★★ モデル名は gemini-2.0-flash になっています ★★★
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
  {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    // generation_config might need adjustment for text generation
    generation_config: {
      temperature: 0.1, // Lower temperature for more deterministic output
      // max_output_tokens: ... // Adjust if needed
    }
  },
  {
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    }
  }
);

    const generatedText = response.data.candidates[0].content.parts[0].text;
    console.log('Geminiからのタイムスタンプ抽出レスポンス: ```json\n' + generatedText + '\n```');

    // GeminiのレスポンスからJSON部分を抽出する改善版
    let jsonString = generatedText;
    
    // 1. マークダウンコードブロックの処理
    const markdownMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (markdownMatch && markdownMatch[1]) {
      jsonString = markdownMatch[1];
      console.log('マークダウンブロックから抽出:', jsonString.substring(0, 100) + '...');
    }
    
    // 2. 前後の空白や改行を除去
    jsonString = jsonString.trim();
    
    // 3. JSON配列を探す - 最も外側の角括弧とその中身を抽出
    let arrayMatch = jsonString.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch && arrayMatch[0]) {
      jsonString = arrayMatch[0];
      console.log('JSON配列パターンを抽出:', jsonString.substring(0, 100) + '...');
    }
    
    // 4. 不正な文字の除去と修正
    // 一般的な問題: 余分なカンマ、引用符の不一致、制御文字など
    jsonString = jsonString
      .replace(/,\s*\]/g, ']')                // 配列末尾の余分なカンマを削除
      .replace(/\]\s*,\s*$/g, ']')            // 配列末尾の余分なカンマを削除
      .replace(/([^\\])\\([^"\\\/bfnrtu])/g, '$1$2'); // 無効なエスケープシーケンスを修正
    
    // 5. JSON.parseを試行
    try {
      const timestamps = JSON.parse(jsonString);
      if (Array.isArray(timestamps)) {
        console.log(`タイムスタンプ抽出完了: ${timestamps.length}個`);
        return timestamps; // 成功: 配列を返す
      } else {
        console.error('抽出されたタイムスタンプが配列形式ではありません:', typeof timestamps);
        
        // 6. オブジェクトから配列を抽出する試み
        if (timestamps && typeof timestamps === 'object' && timestamps.timestamps && Array.isArray(timestamps.timestamps)) {
          console.log(`オブジェクトから配列を抽出: ${timestamps.timestamps.length}個`);
          return timestamps.timestamps;
        }
      }
    } catch (parseError) {
      console.error('タイムスタンプJSONのパースに失敗しました:', parseError);
      
      // 7. 手動パース - 最後の手段
      try {
        // タイムスタンプエントリを正規表現で抽出
        const entries = jsonString.match(/\{\s*"timestamp"\s*:\s*"[^"]+"\s*,\s*"text"\s*:\s*"[^"]*"\s*\}/g);
        if (entries && entries.length > 0) {
          console.log(`正規表現で ${entries.length} 個のエントリを抽出しました`);
          
          // 各エントリを個別にパースして配列を構築
          const manualTimestamps = [];
          for (const entry of entries) {
            try {
              const entryObj = JSON.parse(entry);
              if (entryObj.timestamp && entryObj.text) {
                manualTimestamps.push(entryObj);
              }
            } catch (e) {
              // 個別エントリのパースエラーは無視
            }
          }
          
          if (manualTimestamps.length > 0) {
            console.log(`手動パースで ${manualTimestamps.length} 個のタイムスタンプを抽出しました`);
            return manualTimestamps;
          }
        }
      } catch (manualError) {
        console.error('手動パースにも失敗しました:', manualError);
      }
      
      // 8. 直接文字列から時間と文字列を抽出する最終手段
      try {
        const timeTextPairs = generatedText.match(/["{\s]timestamp[":\s]+["']?(\d{2}:\d{2}:\d{2})["']?[,\s]+[":]?text[":\s]+["']([^"']+)["']/g);
        if (timeTextPairs && timeTextPairs.length > 0) {
          const extractedPairs = [];
          for (const pair of timeTextPairs) {
            const timeMatch = pair.match(/(\d{2}:\d{2}:\d{2})/);
            const textMatch = pair.match(/text[":\s]+["']([^"']+)["']/);
            if (timeMatch && textMatch) {
              extractedPairs.push({
                timestamp: timeMatch[1],
                text: textMatch[1]
              });
            }
          }
          if (extractedPairs.length > 0) {
            console.log(`最終手段で ${extractedPairs.length} 個のタイムスタンプを抽出しました`);
            return extractedPairs;
          }
        }
      } catch (finalError) {
        console.error('最終抽出手段にも失敗しました:', finalError);
      }
      
      console.error('抽出試行文字列:', jsonString);
      console.error('Gemini Raw Response:', generatedText);
    }

    // パース失敗、非配列、または配列形式が見つからない場合はnullを返す
    return null;
    
  } catch (error: any) { // Outer catch for the axios request
    console.error('Gemini APIでのタイムスタンプ抽出中にエラーが発生しました:', error.response?.data || error.message || error);
    return null; // エラー時もnullを返す
  }
}

/**
 * BullMQワーカーのプロセッサ関数
 * @param job BullMQジョブオブジェクト
 */
const transcriptionProcessor = async (job: Job<JobData>) => {
  // ★★★ ジョブ受信ログ ★★★
  console.log(`[Transcription Worker] Received job ${job.id}:`, JSON.stringify(job.data, null, 2)); // Use job.data here

  const { recordId, fileKey } = job.data; // Access data from job.data
  let tempDir: string | null = null;

  try {
    console.log(`[${QUEUE_NAME}] Processing job ${job.id} for record ${recordId}`);

    // 処理状態の更新 (PROCESSING)
    await prisma.record.update({
      where: { id: recordId },
      data: {
        status: Status.PROCESSING,
        processing_step: 'DOWNLOAD',
        processing_progress: 5,
        error: null
      }
    });
    console.log(`[${recordId}] Status updated to PROCESSING`);

    // 一時ディレクトリを作成
    tempDir = path.join(TMP_DIR, `transcription-${crypto.randomBytes(6).toString('hex')}`);
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`[${recordId}] Temporary directory created: ${tempDir}`);

    let tempFilePath: string | null = null;

    // ファイルダウンロードロジック (R2 or URL)
    try {
      const record = await prisma.record.findUnique({ where: { id: recordId } });
      if (!record) throw new Error(`Record not found in DB: ${recordId}`);

      const effectiveFileKey = fileKey || record.file_key;
      const effectiveFileUrl = record.file_url;

      if (!effectiveFileKey && !effectiveFileUrl) throw new Error('File key and URL are both missing');

      if (effectiveFileKey) {
        try {
          console.log(`[${recordId}] Attempting download from R2: ${effectiveFileKey}`, { fileKeyLength: effectiveFileKey.length });
          // ストリーミング処理を使用して直接ファイルに書き込む
          const fileName = effectiveFileKey.split('/').pop() || `${Date.now()}.mp4`;
          tempFilePath = path.join(tempDir, fileName);
          await streamToFile(effectiveFileKey, tempFilePath);
          console.log(`[${recordId}] Successfully wrote R2 data to ${tempFilePath}`, { fileSize: fs.statSync(tempFilePath).size });
        } catch (r2Error) {
          console.error(`[${recordId}] R2 download failed for key ${effectiveFileKey}:`, r2Error);
          if (!effectiveFileUrl) throw r2Error; // Rethrow if URL fallback is not possible
        }
      }

      if (!tempFilePath && effectiveFileUrl) {
        try {
          console.log(`[${recordId}] Attempting download from URL: ${effectiveFileUrl}`);
          const urlParts = new URL(effectiveFileUrl);
          const pathParts = urlParts.pathname.split('/');
          const fileName = decodeURIComponent(pathParts[pathParts.length - 1]) || `${Date.now()}.mp4`;
          const response = await axios.get(effectiveFileUrl, { responseType: 'arraybuffer', timeout: 120000 });
          tempFilePath = path.join(tempDir, fileName);
          fs.writeFileSync(tempFilePath, Buffer.from(response.data));
          console.log(`[${recordId}] Successfully wrote URL data to ${tempFilePath}`);
        } catch (urlError: any) {
          console.error(`[${recordId}] Public URL download failed:`, urlError);
          throw new Error(`Failed to download file from URL: ${urlError.message}`);
        }
      }

      if (!tempFilePath) throw new Error('All download methods failed');

    } catch (downloadError) {
      console.error(`[${recordId}] File download error:`, downloadError);
      throw new Error(`File download failed: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`);
    }

    // 進捗更新 (ダウンロード完了)
    await job.updateProgress(10);
    await prisma.record.update({
      where: { id: recordId },
      data: { processing_step: 'TRANSCRIPTION_AUDIO_EXTRACTION', processing_progress: 10 }
    });

    // ファイル処理（音声抽出、最適化、チャンク処理を含む）
    console.log(`[${recordId}] Starting audio processing for file: ${tempFilePath}`);
    const transcriptParts = await processLargeFile(tempFilePath);
    const fullTranscript = transcriptParts.join('\n\n');
    console.log(`[${recordId}] Audio processing completed. Transcript length: ${fullTranscript.length}`);

    // 進捗更新 (文字起こし完了)
    await job.updateProgress(80);
    await prisma.record.update({
      where: { id: recordId },
      data: { processing_step: 'TRANSCRIPTION_SAVING', processing_progress: 80 }
    });

    // タイムスタンプ抽出
    let timestampsJson: string | null = null;
    try {
      const timestampsArray = await extractTimestampsWithGemini(fullTranscript);
      if (timestampsArray) {
        timestampsJson = JSON.stringify(timestampsArray);
        console.log(`[${recordId}] Timestamps extracted and stringified.`);
      } else {
        console.warn(`[${recordId}] Timestamp extraction did not return a valid array.`);
      }
    } catch (timestampError) {
      console.error(`[${recordId}] Error during timestamp extraction call:`, timestampError);
    }

    // DB更新 (最終結果)
    await prisma.record.update({
      where: { id: recordId },
      data: {
        transcript_text: fullTranscript,
        timestamps_json: timestampsJson,
        status: Status.TRANSCRIBED,
        processing_step: null,
        processing_progress: 100
      }
    });
    console.log(`[${recordId}] Successfully saved transcript and timestamps to DB`);

    // 次のキューにジョブを追加
    await queueManager.addJob(SUMMARY_QUEUE, {
      type: 'summary',
      recordId: recordId,
      fileKey: fileKey // Pass original fileKey if needed by summary
    });
    console.log(`[${recordId}] Successfully added job to summary queue`);

    // ジョブ完了 (BullMQでは return で完了を示す)
    console.log(`[${recordId}] Transcription job ${job.id} completed successfully`);
    return { success: true }; // Indicate successful completion

  } catch (error) {
    console.error(`[${QUEUE_NAME}] Error processing job ${job?.id} for record ${job?.data?.recordId}:`, error); // Use job.data here
    // エラー情報をDBに記録
    if (job?.data?.recordId) { // Use job.data here
      try {
        await prisma.record.update({
          where: { id: job.data.recordId }, // Use job.data here
          data: {
            status: Status.ERROR,
            error: error instanceof Error ? error.message : String(error),
            processing_step: null,
            processing_progress: null
          }
        });
        console.error(`[${job.data.recordId}] Updated record status to ERROR`); // Use job.data here
      } catch (dbError: any) {
        console.error(`[${job.data.recordId}] CRITICAL: Failed to update record status to ERROR:`, dbError); // Use job.data here
      }
    }
    // エラーを再スローしてBullMQに失敗を通知
    throw error;
  } finally {
    // 一時ディレクトリの削除
    if (tempDir) {
      try {
        console.log(`[${job?.data?.recordId || 'Unknown Record'}] Cleaning up temporary directory: ${tempDir}`); // Use job.data here
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`[${job?.data?.recordId || 'Unknown Record'}] Temporary directory cleaned up: ${tempDir}`); // Use job.data here
      } catch (cleanupError) {
        console.error(`[${job?.data?.recordId || 'Unknown Record'}] Failed to clean up temporary directory ${tempDir}:`, cleanupError); // Use job.data here
      }
    }
  }
};

// Helper function for logging memory usage
function logMemoryUsage(context: string = '') {
    const memoryUsage = process.memoryUsage();
    const rss = Math.round(memoryUsage.rss / 1024 / 1024);
    const heapTotal = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const heapUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    console.log(`[Memory Usage${context ? ' - ' + context : ''}] RSS=${rss}MB Heap=${heapUsed}/${heapTotal}MB`);
}

// --- BullMQ Worker Initialization ---
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('REDIS_URL environment variable is not set. Worker cannot start.');
  process.exit(1);
}

// ★★★ Worker用に新しいRedis接続を作成 ★★★
const workerConnection = new IORedis(redisUrl, {
  // Worker用の接続オプション (必要に応じて調整)
  maxRetriesPerRequest: null, // Workerにはnullが推奨される場合がある
  enableReadyCheck: false,
  connectTimeout: 10000
});

// 接続エラーハンドリングを追加 (errに型を追加)
workerConnection.on('error', (err: Error) => {
  console.error(`[${QUEUE_NAME}] Worker Redis connection error:`, err);
  // 必要に応じてプロセスを終了させるなどの処理を追加
  process.exit(1);
});

// 接続成功時のログ
workerConnection.on('connect', () => {
    console.log(`[${QUEUE_NAME}] Worker successfully connected to Redis.`);
});

// if (!workerConnection) { // このチェックは不要になる
//     console.error(`Could not get Redis connection for queue ${QUEUE_NAME}. Worker cannot start.`);
//     process.exit(1);
// }


console.log(`[${QUEUE_NAME}] Initializing worker...`);
logMemoryUsage('Initial');

const worker = new Worker(QUEUE_NAME, transcriptionProcessor, {
  connection: workerConnection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'), // Allow concurrency configuration
  lockDuration: 180000, // ロックの有効期間を3分に延長（デフォルトは30秒）
  lockRenewTime: 60000, // ロック更新間隔を1分に設定（デフォルトはlockDurationの半分）
  limiter: { // Optional: Add rate limiting if needed
    max: 10, // Max 10 jobs per
    duration: 1000 // 1 second
  }
});

worker.on('completed', (job: Job, result: any) => {
  console.log(`[${QUEUE_NAME}] Job ${job.id} completed successfully.`);
  logMemoryUsage(`Completed Job ${job.id}`);
});

worker.on('failed', (job: Job | undefined, error: Error) => {
  console.error(`[${QUEUE_NAME}] Job ${job?.id} failed:`, error);
  logMemoryUsage(`Failed Job ${job?.id}`);
  // Error is already logged and status updated in the processor's catch block
});

worker.on('error', (error: Error) => {
  // This logs errors related to the worker itself (e.g., connection issues)
  console.error(`[${QUEUE_NAME}] Worker encountered an error:`, error);
  logMemoryUsage('Worker Error');
});

worker.on('ready', () => {
  console.log(`[${QUEUE_NAME}] Worker is ready and listening for jobs.`);
});

console.log(`[${QUEUE_NAME}] Worker started. Node version: ${process.version}`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`[${QUEUE_NAME}] SIGTERM received, closing worker...`);
  await worker.close();
  await prisma.$disconnect();
  console.log(`[${QUEUE_NAME}] Worker closed.`);
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log(`[${QUEUE_NAME}] SIGINT received, closing worker...`);
  await worker.close();
  await prisma.$disconnect();
  console.log(`[${QUEUE_NAME}] Worker closed.`);
  process.exit(0);
});
