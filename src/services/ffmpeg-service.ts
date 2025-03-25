import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import ffmpegStatic from 'ffmpeg-static';

// FFmpegを使用して動画から音声を抽出するサービス
export class FFmpegService {
  private tempDir: string;

  constructor() {
    // FFmpegの静的バイナリパスを設定
    if (ffmpegStatic) {
      ffmpeg.setFfmpegPath(ffmpegStatic);
    }
    
    // 環境変数から一時ディレクトリを取得するか、デフォルトを使用
    this.tempDir = process.env.FFMPEG_TEMP_DIR || path.join(os.tmpdir(), 'ffmpeg-temp');
    
    // 一時ディレクトリが存在しない場合は作成
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    console.log(`FFmpegService初期化完了: 一時ディレクトリ=${this.tempDir}`);
  }

  /**
   * 動画ファイルから音声を抽出する
   * @param videoPath 動画ファイルのパス
   * @param format 出力する音声フォーマット（mp3, wav, etc.）
   * @returns 抽出された音声ファイルのパス
   */
  async extractAudio(videoPath: string, format: string = 'mp3'): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`動画ファイルが見つかりません: ${videoPath}`);
    }

    // 出力ファイル名を生成（ランダムな文字列を追加して一意にする）
    const randomId = crypto.randomBytes(8).toString('hex');
    const outputFileName = `audio-${randomId}.${format}`;
    const outputPath = path.join(this.tempDir, outputFileName);

    console.log(`動画から音声を抽出します: ${videoPath} -> ${outputPath}`);

    return new Promise((resolve, reject) => {
      // FFmpegコマンドを設定
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec(format === 'mp3' ? 'libmp3lame' : 'pcm_s16le')
        .audioBitrate('128k')
        .audioChannels(2)
        .audioFrequency(44100)
        .output(outputPath)
        .on('start', (commandLine: string) => {
          console.log('FFmpegコマンド:', commandLine);
        })
        .on('progress', (progress: any) => {
          if (progress.percent) {
            console.log(`処理進捗: ${Math.round(progress.percent)}%`);
          }
        })
        .on('error', (err: Error, stdout: string, stderr: string) => {
          console.error('FFmpegエラー:', err);
          console.error('FFmpeg stderr:', stderr);
          reject(err);
        })
        .on('end', () => {
          console.log('音声抽出が完了しました');
          resolve(outputPath);
        })
        .run();
    });
  }

  /**
   * 動画ファイルのメタデータを取得する
   * @param filePath ファイルパス
   * @returns メタデータオブジェクト
   */
  async getMetadata(filePath: string): Promise<any> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`ファイルが見つかりません: ${filePath}`);
    }

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: Error, metadata: any) => {
        if (err) {
          console.error('メタデータ取得エラー:', err);
          reject(err);
          return;
        }
        resolve(metadata);
      });
    });
  }

  /**
   * 一時ファイルを削除する
   * @param filePath 削除するファイルのパス
   */
  async cleanupFile(filePath: string): Promise<void> {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`ファイルを削除しました: ${filePath}`);
      } catch (error) {
        console.error(`ファイル削除エラー: ${filePath}`, error);
      }
    }
  }

  /**
   * すべての一時ファイルを削除する
   */
  async cleanupAllTempFiles(): Promise<void> {
    if (fs.existsSync(this.tempDir)) {
      try {
        const files = fs.readdirSync(this.tempDir);
        for (const file of files) {
          const filePath = path.join(this.tempDir, file);
          fs.unlinkSync(filePath);
          console.log(`一時ファイルを削除しました: ${filePath}`);
        }
        console.log('すべての一時ファイルを削除しました');
      } catch (error) {
        console.error('一時ファイル削除エラー:', error);
      }
    }
  }
}

// シングルトンインスタンスをエクスポート
export const ffmpegService = new FFmpegService();
