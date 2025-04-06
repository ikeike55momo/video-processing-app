import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import { PrismaClient, Status } from '@prisma/client';
import { getJob, completeJob, failJob, addJob, JobData } from '../lib/queue';
import { getFileContents, getDownloadUrl } from '../lib/storage';
import { execSync } from 'child_process';
import axios from 'axios';
// import { extractTimestamps } from '../services/timestamp-service'; // 仮のインポート削除

// 環境変数の読み込み
dotenv.config();

// Prismaクライアントの初期化
const prisma = new PrismaClient();

// キュー名の定義
const QUEUE_NAME = 'transcription';
const SUMMARY_QUEUE = 'summary';

// 一時ファイルディレクトリ
const TMP_DIR = process.env.TMP_DIR || '/tmp';

// 最大ファイルサイズ（バイト単位）- 4MB
const MAX_DIRECT_PROCESS_SIZE = 4 * 1024 * 1024;

// チャンクの最大時間（秒）
const CHUNK_DURATION = 300; // 5分

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

重要:
- 必ず上記のJSON配列形式で出力してください。
- タイムスタンプはテキストの内容に基づいて可能な限り正確に推定してください。
- 元のテキストの内容は変更しないでください。
- 架空の内容やタイムスタンプを生成しないでください。

文字起こしテキスト:
---
${transcriptText}
---
`;

    console.log('Gemini APIにタイムスタンプ抽出リクエストを送信します...');
    const response = await axios.post(
      // Use a text-focused model endpoint if available and suitable, otherwise flash might work
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
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
    console.log('Geminiからのタイムスタンプ抽出レスポンス:', generatedText);

    // GeminiのレスポンスからJSON部分を抽出してパース
    // 応答が ```json ... ``` で囲まれている場合を考慮
    const jsonMatch = generatedText.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonString = jsonMatch ? jsonMatch[1] : generatedText;

    try {
      const timestamps = JSON.parse(jsonString);
      if (Array.isArray(timestamps)) {
        console.log(`タイムスタンプ抽出完了: ${timestamps.length}個`);
        return timestamps;
      } else {
        console.error('抽出されたタイムスタンプが配列形式ではありません:', timestamps);
        return null;
      }
    } catch (parseError) {
      console.error('タイムスタンプJSONのパースに失敗しました:', parseError);
      console.error('Gemini Raw Response:', generatedText); // パース失敗時に生の応答をログ出力
      return null; // パース失敗時はnullを返す
    }

  } catch (error: any) {
    console.error('Gemini APIでのタイムスタンプ抽出中にエラーが発生しました:', error.response?.data || error.message || error);
    return null; // エラー時もnullを返す
  }
}


/**
 * ジョブを処理する関数
 */
async function processJob() {
  let job: JobData | null = null; // Explicitly type job
  let tempDir: string | null = null; // Keep track of tempDir for cleanup

  try {
    console.log(`[${QUEUE_NAME}] Waiting for job...`);
    // キューからジョブを取得
    job = await getJob(QUEUE_NAME);
    if (!job) {
      // console.log(`[${QUEUE_NAME}] No job found. Waiting...`); // Reduce log noise
      return;
    }

    // ★★★ ジョブ受信ログ ★★★
    console.log(`[Transcription Worker] Received job ${job.id} with data:`, JSON.stringify(job.data, null, 2));

    console.log(`[${QUEUE_NAME}] Processing job ${job.id} for record ${job.recordId}`);

    // 処理状態の更新 (PROCESSING)
    try {
      console.log(`[${job.recordId}] Updating status to PROCESSING`);
      await prisma.record.update({
        where: { id: job.recordId },
        data: {
          status: Status.PROCESSING, // 列挙型を使用
          processing_step: 'DOWNLOAD', // Start with download step
          processing_progress: 5, // Initial progress
          error: null // Clear previous errors
        }
      });
      console.log(`[${job.recordId}] Status updated to PROCESSING`);
    } catch (dbError: any) {
      console.error(`[${job.recordId}] Failed to update status to PROCESSING:`, dbError);
      // If update fails, we might not be able to proceed or mark as failed later
      // Consider failing the job immediately if this is critical
      await failJob(QUEUE_NAME, job.id); // Fail the job if initial update fails
      return; // Stop processing this job
    }

    // R2からファイルを取得
    console.log(`[${job.recordId}] Attempting to download file (fileKey: ${job.fileKey})`);
    let fileData;
    let tempFilePath: string | null = null; // Initialize as null

    // 一時ディレクトリを作成
    tempDir = path.join(TMP_DIR, `transcription-${crypto.randomBytes(6).toString('hex')}`);
    console.log(`[${job.recordId}] Creating temporary directory: ${tempDir}`);
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`[${job.recordId}] Temporary directory created: ${tempDir}`);

    try {
      // レコード情報を取得 (再確認)
      console.log(`[${job.recordId}] Fetching record details from DB`);
      const record = await prisma.record.findUnique({
        where: { id: job.recordId }
      });

      if (!record) {
        throw new Error(`Record not found in DB: ${job.recordId}`);
      }
      console.log(`[${job.recordId}] Record details fetched. file_key=${record.file_key || 'N/A'}, file_url=${record.file_url || 'N/A'}`);

      // ファイルキーまたはURLを決定
      const fileKey = job.fileKey || record.file_key;
      const fileUrl = record.file_url;

      if (!fileKey && !fileUrl) {
        throw new Error('File key and URL are both missing');
      }

      // まずR2からファイルの取得を試みる
      if (fileKey) {
        try {
          console.log(`[${job.recordId}] Attempting download from R2: ${fileKey}`);
          fileData = await getFileContents(fileKey);
          console.log(`[${job.recordId}] Downloaded ${fileData.length} bytes from R2`);

          // ファイル名を決定
          let fileName = fileKey.split('/').pop() || `${Date.now()}.mp4`; // Default filename
          console.log(`[${job.recordId}] Determined filename: ${fileName}`);

          // 一時ファイルに保存
          tempFilePath = path.join(tempDir, fileName);
          console.log(`[${job.recordId}] Writing R2 data to temporary file: ${tempFilePath}`);
          fs.writeFileSync(tempFilePath, fileData);
          console.log(`[${job.recordId}] Successfully wrote R2 data to ${tempFilePath}`);
        } catch (r2Error) {
          console.error(`[${job.recordId}] R2 download failed for key ${fileKey}:`, r2Error);
          // エラーを記録するが、次の方法を試みる
        }
      }

      // R2からの取得に失敗した場合、公開URLを試みる
      if (!tempFilePath && fileUrl) {
        try {
          console.log(`[${job.recordId}] R2 download failed or skipped. Attempting download from URL: ${fileUrl}`);
          // URLからファイル名を抽出
          const urlParts = new URL(fileUrl);
          const pathParts = urlParts.pathname.split('/');
          const fileName = decodeURIComponent(pathParts[pathParts.length - 1]) || `${Date.now()}.mp4`; // Decode URI component
          console.log(`[${job.recordId}] Extracted filename from URL: ${fileName}`);

          // 公開URLを使用してファイルにアクセス
          console.log(`[${job.recordId}] Accessing public URL: ${fileUrl}`);
          const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            timeout: 120000 // 120秒タイムアウトに延長
          });
          console.log(`[${job.recordId}] Received response from URL. Status: ${response.status}, Size: ${response.data.length} bytes`);

          // 一時ファイルに保存
          tempFilePath = path.join(tempDir, fileName);
          console.log(`[${job.recordId}] Writing URL data to temporary file: ${tempFilePath}`);
          fs.writeFileSync(tempFilePath, Buffer.from(response.data));
          console.log(`[${job.recordId}] Successfully wrote URL data to ${tempFilePath}`);

          // ファイルサイズを確認
          const fileStats = fs.statSync(tempFilePath);
          console.log(`[${job.recordId}] Downloaded file info: Exists=${fs.existsSync(tempFilePath)}, Size=${fileStats.size} bytes (${Math.round(fileStats.size / (1024 * 1024))} MB)`);
        } catch (urlError: any) {
          console.error(`[${job.recordId}] Public URL download failed:`, urlError);
          throw new Error(`Failed to download file from URL: ${urlError.message}`);
        }
      }

      // ファイルが取得できなかった場合
      if (!tempFilePath) {
        throw new Error('All download methods failed (R2 and URL)');
      }
    } catch (downloadError) {
      console.error(`[${job.recordId}] File download error:`, downloadError);
      // No need to manually delete tempDir here, finally block will handle it
      throw new Error(`File download failed: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`);
    }

    // 処理進捗状況を更新 (ダウンロード完了)
    try {
      console.log(`[${job.recordId}] Updating progress to 10% (Download complete)`);
      await prisma.record.update({
        where: { id: job.recordId },
        data: {
          processing_step: 'TRANSCRIPTION_AUDIO_EXTRACTION',
          processing_progress: 10
        }
      });
      console.log(`[${job.recordId}] Progress updated to 10%`);
    } catch (dbError: any) {
      console.error(`[${job.recordId}] Failed to update progress after download:`, dbError);
      // Continue processing, but log the error
    }

    // ファイル処理（音声抽出、最適化、チャンク処理を含む）
    console.log(`[${job.recordId}] Starting audio processing for file: ${tempFilePath}`);
    const transcriptParts = await processLargeFile(tempFilePath); // This function now includes audio extraction
    console.log(`[${job.recordId}] Audio processing completed. Transcript parts received: ${transcriptParts.length}`);

    // 処理進捗状況を更新 (文字起こし完了)
    try {
      console.log(`[${job.recordId}] Updating progress to 80% (Transcription complete)`);
      await prisma.record.update({
        where: { id: job.recordId },
        data: {
          processing_step: 'TRANSCRIPTION_SAVING',
          processing_progress: 80
        }
      });
      console.log(`[${job.recordId}] Progress updated to 80%`);
    } catch (dbError: any) {
      console.error(`[${job.recordId}] Failed to update progress after transcription:`, dbError);
      // Continue processing, but log the error
    }

    // 結果をデータベースに保存
    const fullTranscript = transcriptParts.join('\n\n');
    console.log(`[${job.recordId}] Full transcript length: ${fullTranscript.length}`);

    // ★★★ タイムスタンプ抽出処理 ★★★
    let timestampsJson: string | null = null;
    try {
      // 上で定義した関数を呼び出す
      const timestampsArray = await extractTimestampsWithGemini(fullTranscript);
      if (timestampsArray) {
        timestampsJson = JSON.stringify(timestampsArray);
        console.log(`[${job.recordId}] Timestamps extracted and stringified.`);
      } else {
        console.warn(`[${job.recordId}] Timestamp extraction did not return a valid array.`);
      }
    } catch (timestampError) {
      console.error(`[${job.recordId}] Error during timestamp extraction call:`, timestampError);
      // 抽出エラーは警告に留め、処理は続行
    }

    try {
      console.log(`[${job.recordId}] Updating DB with transcript, timestamps, and status TRANSCRIBED`);
      await prisma.record.update({
        where: { id: job.recordId },
        data: {
          transcript_text: fullTranscript,
          timestamps_json: timestampsJson, // ★★★ タイムスタンプJSONを保存 ★★★
          status: Status.TRANSCRIBED, // 列挙型を使用
          processing_step: null, // Clear step on successful stage completion
          processing_progress: 100 // Mark as 100% for this stage
        }
      });
      console.log(`[${job.recordId}] Successfully saved transcript and timestamps to DB`);
    } catch (dbError: any) {
      console.error(`[${job.recordId}] Database update error after transcription:`, dbError);
      throw new Error(`Database update failed: ${dbError.message}`);
    }

    // 要約キューにジョブを追加
    try {
      console.log(`[${job.recordId}] Adding job to summary queue`);
      await addJob(SUMMARY_QUEUE, {
        type: 'summary',
        recordId: job.recordId,
        fileKey: job.fileKey // Pass fileKey along
      });
      console.log(`[${job.recordId}] Successfully added job to summary queue`);
    } catch (queueError: any) {
      console.error(`[${job.recordId}] Failed to add job to summary queue:`, queueError);
      // If adding to the next queue fails, the process stops here for this record.
      // Consider how to handle this - maybe update status to a specific error state?
      throw new Error(`Failed to queue summary job: ${queueError.message}`);
    }

    // 一時ファイルの削除 (tempFilePath should be valid here)
    // Moved to finally block

    // ジョブを完了としてマーク
    try {
      console.log(`[${job.recordId}] Marking transcription job ${job.id} as complete`);
      await completeJob(QUEUE_NAME, job.id);
      console.log(`[${job.recordId}] Transcription job ${job.id} completed successfully`);
    } catch (completeError: any) {
      console.error(`[${job.recordId}] Failed to mark job ${job.id} as complete:`, completeError);
      // Log error but proceed, as the main work is done.
    }

  } catch (error) {
    console.error(`[${QUEUE_NAME}] Error processing job ${job?.id} for record ${job?.recordId}:`, error);

    // ジョブIDがある場合のみリトライを実行
    if (job?.id && job.recordId) { // Ensure recordId is also available
      try {
        console.error(`[${job.recordId}] Attempting to mark job ${job.id} as failed`);
        await failJob(QUEUE_NAME, job.id);
        console.error(`[${job.recordId}] Marked job ${job.id} as failed`);
      } catch (failJobError: any) {
        console.error(`[${job.recordId}] CRITICAL: Failed to mark job ${job.id} as failed:`, failJobError);
      }

      // エラーステータスを記録
      try {
        console.error(`[${job.recordId}] Attempting to update record status to ERROR`);
        await prisma.record.update({
          where: { id: job.recordId },
          data: {
            status: Status.ERROR, // 列挙型を使用
            error: error instanceof Error ? error.message : String(error),
            processing_step: null, // Clear step on error
            processing_progress: null // Clear progress on error
          }
        });
        console.error(`[${job.recordId}] Updated record status to ERROR`);
      } catch (dbError: any) {
        console.error(`[${job.recordId}] CRITICAL: Failed to update record status to ERROR:`, dbError);
      }
    } else {
      console.error(`[${QUEUE_NAME}] Cannot fail job or update record status because job or recordId is missing.`);
    }
  } finally {
    // 一時ディレクトリの削除 (ensure tempDir was created)
    if (tempDir) {
      try {
        console.log(`[${job?.recordId || 'Unknown Record'}] Cleaning up temporary directory: ${tempDir}`);
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`[${job?.recordId || 'Unknown Record'}] Temporary directory cleaned up: ${tempDir}`);
      } catch (cleanupError) {
        console.error(`[${job?.recordId || 'Unknown Record'}] Failed to clean up temporary directory ${tempDir}:`, cleanupError);
      }
    }
  }
}


// Helper function for logging memory usage (optional, can be removed if not needed)
function logMemoryUsage(context: string = '') {
    const memoryUsage = process.memoryUsage();
    const rss = Math.round(memoryUsage.rss / 1024 / 1024);
    const heapTotal = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const heapUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    console.log(`[Memory Usage${context ? ' - ' + context : ''}] RSS=${rss}MB Heap=${heapUsed}/${heapTotal}MB`);
}


/**
 * メインワーカー処理
 */
async function startWorker() {
  console.log(`[${QUEUE_NAME}] Worker starting... Node version: ${process.version}`);
  logMemoryUsage('Initial');

  try {
    // 継続的にジョブを処理
    while (true) {
      try {
        await processJob();
      } catch (jobError) {
        // processJob内でエラーは処理されるはずだが、念のためキャッチ
        console.error(`[${QUEUE_NAME}] Uncaught error during processJob loop:`, jobError);
      }
      // 少し待機してからポーリング
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1秒待機
    }
  } catch (error) {
    console.error(`[${QUEUE_NAME}] Worker encountered a fatal error:`, error);
    logMemoryUsage('Fatal Error');
    process.exit(1); // Exit if the loop itself fails critically
  }
}

// ワーカー開始
startWorker().catch(error => {
  console.error('ワーカーの起動に失敗:', error);
  process.exit(1);
});
