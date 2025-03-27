import { GeminiService } from './gemini-service';
import { ClaudeService } from './claude-service';
import { TranscriptionService } from './transcription-service';
import prisma from '@/lib/prisma';

// AI処理パイプラインを管理するクラス
export class ProcessingPipeline {
  private geminiService: GeminiService;
  private claudeService: ClaudeService;
  private transcriptionService: TranscriptionService;

  constructor() {
    this.geminiService = new GeminiService();
    this.claudeService = new ClaudeService();
    this.transcriptionService = new TranscriptionService();
  }

  // 処理パイプラインを実行
  async processVideo(recordId: string): Promise<void> {
    try {
      console.log(`[${recordId}] 処理パイプラインを開始します...`);
      
      // レコードの取得
      const record = await prisma.record.findUnique({
        where: { id: recordId },
      });
      
      if (!record) {
        throw new Error(`レコードが見つかりません: ${recordId}`);
      }
      
      console.log(`[${recordId}] レコードが見つかりました:`, record);
      console.log(`[${recordId}] ファイルURL:`, record.file_url);
      
      if (!record.file_url) {
        throw new Error('ファイルURLが設定されていません');
      }
      
      const fileUrl = record.file_url;
      
      // ステータスをPROCESSINGに更新
      await prisma.record.update({
        where: { id: recordId },
        data: { status: 'PROCESSING' },
      });

      // 1. 高精度文字起こし処理（Gemini FlashとSpeech-to-Textの組み合わせ）
      console.log(`[${recordId}] 高精度文字起こし処理を開始します...`);
      console.log(`[${recordId}] 使用するファイルURL:`, fileUrl);
      let transcript;
      try {
        // 新しいTranscriptionServiceを使用
        transcript = await this.transcriptionService.transcribeFile(fileUrl);
        console.log(`[${recordId}] 高精度文字起こし処理が成功しました`);
        
        await prisma.record.update({
          where: { id: recordId },
          data: { transcript_text: transcript },
        });
        console.log(`[${recordId}] 文字起こし結果をデータベースに保存しました`);
      } catch (transcriptError) {
        console.error(`[${recordId}] 文字起こし処理エラー:`, transcriptError);
        
        // フォールバック: 従来のGemini文字起こしを試行
        try {
          console.log(`[${recordId}] フォールバック: 従来のGemini文字起こしを試行します...`);
          transcript = await this.geminiService.transcribeAudio(fileUrl);
          
          await prisma.record.update({
            where: { id: recordId },
            data: { transcript_text: transcript },
          });
          console.log(`[${recordId}] フォールバック文字起こし結果をデータベースに保存しました`);
        } catch (fallbackError) {
          console.error(`[${recordId}] フォールバック文字起こし処理エラー:`, fallbackError);
          
          // エラー情報をデータベースに保存
          await prisma.record.update({
            where: { id: recordId },
            data: { 
              error: fallbackError instanceof Error ? fallbackError.message : '文字起こし処理中にエラーが発生しました',
              status: 'ERROR'
            },
          });
          
          throw fallbackError;
        }
      }
      console.log(`[${recordId}] 文字起こし処理が完了しました`);

      // 文字起こし結果をそのまま使用（整形・改善処理を行わない）
      let originalTranscript = transcript;
      
      console.log(`[${recordId}] 文字起こし結果: ${originalTranscript.substring(0, 100)}...`);
      
      // 2. 要約処理
      console.log(`[${recordId}] 要約処理を開始します...`);
      let summary;
      try {
        summary = await this.geminiService.summarizeText(originalTranscript);
        console.log(`[${recordId}] 要約処理が成功しました`);
        
        await prisma.record.update({
          where: { id: recordId },
          data: { summary_text: summary },
        });
        console.log(`[${recordId}] 要約結果をデータベースに保存しました`);
      } catch (summaryError) {
        console.error(`[${recordId}] 要約処理エラー:`, summaryError);
        
        // エラー情報をデータベースに保存
        await prisma.record.update({
          where: { id: recordId },
          data: { 
            error: summaryError instanceof Error ? summaryError.message : '要約処理中にエラーが発生しました',
            status: 'ERROR'
          },
        });
        
        throw summaryError;
      }
      console.log(`[${recordId}] 要約処理が完了しました`);

      // 3. 記事生成処理
      console.log(`[${recordId}] 記事生成処理を開始します...`);
      console.log(`[${recordId}] 要約テキスト:`, summary.substring(0, 100) + '...');
      let article;
      try {
        // OpenRouter APIキーの確認
        const openrouterApiKey = process.env.OPENROUTER_API_KEY;
        if (!openrouterApiKey) {
          throw new Error('OpenRouter APIキーが設定されていません');
        }
        
        article = await this.claudeService.generateArticle(summary);
        console.log(`[${recordId}] 記事生成処理が成功しました`);
        
        await prisma.record.update({
          where: { id: recordId },
          data: { 
            article_text: article,
            status: 'DONE'
          },
        });
        console.log(`[${recordId}] 記事生成結果をデータベースに保存しました`);
      } catch (articleError) {
        console.error(`[${recordId}] 記事生成処理エラー:`, articleError);
        console.error(`[${recordId}] エラーの詳細:`, {});
        
        // エラー情報をデータベースに保存
        await prisma.record.update({
          where: { id: recordId },
          data: { 
            error: articleError instanceof Error ? articleError.message : '記事生成処理中にエラーが発生しました',
            status: 'ERROR'
          },
        });
        
        throw articleError;
      }
      console.log(`[${recordId}] 記事生成処理が完了しました`);

      console.log(`[${recordId}] 全ての処理が完了しました`);
    } catch (error) {
      console.error(`処理パイプラインエラー [${recordId}]:`, error);
      
      try {
        // エラー情報を保存
        await prisma.record.update({
          where: { id: recordId },
          data: { 
            status: 'ERROR',
            error: error instanceof Error ? error.message : '不明なエラーが発生しました'
          },
        });
      } catch (dbError) {
        console.error(`データベース更新エラー [${recordId}]:`, dbError);
      }
      
      throw error;
    }
  }

  // 処理を再試行
  async retryProcessing(recordId: string): Promise<void> {
    try {
      const record = await prisma.record.findUnique({
        where: { id: recordId },
      });

      if (!record) {
        throw new Error('指定されたレコードが見つかりません');
      }

      // ステータスをPROCESSINGに更新
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          status: 'PROCESSING',
          error: null // エラー情報をクリア
        },
      });

      // 処理を再実行
      return this.processVideo(recordId);
    } catch (error) {
      console.error(`再試行エラー [${recordId}]:`, error);
      throw error;
    }
  }

  // 特定のステップから処理を再試行
  async retryFromStep(recordId: string, step: number): Promise<void> {
    try {
      console.log(`[${recordId}] ステップ ${step} から処理を再試行します...`);
      
      const record = await prisma.record.findUnique({
        where: { id: recordId },
      });

      if (!record) {
        throw new Error('指定されたレコードが見つかりません');
      }

      // ステータスをPROCESSINGに更新
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          status: 'PROCESSING',
          error: null
        },
      });

      const fileUrl = record.file_url;
      
      // ステップに応じて処理を実行
      switch (step) {
        case 1: // アップロードからやり直し（何もしない）
          console.log(`[${recordId}] アップロードは既に完了しています。次のステップに進みます。`);
          break;
          
        case 2: // 文字起こしからやり直し
          console.log(`[${recordId}] 文字起こし処理を開始します...`);
          try {
            const transcript = await this.transcriptionService.transcribeFile(fileUrl);
            console.log(`[${recordId}] 文字起こし処理が成功しました`);
            
            await prisma.record.update({
              where: { id: recordId },
              data: { transcript_text: transcript },
            });
            console.log(`[${recordId}] 文字起こし結果をデータベースに保存しました`);
            
            // 文字起こし結果をそのまま使用（整形・改善処理を行わない）
            let originalTranscript = transcript;
            
            console.log(`[${recordId}] 文字起こし結果: ${originalTranscript.substring(0, 100)}...`);
            
            // 要約処理に進む
            await this.retryFromStep(recordId, 3);
            return;
          } catch (transcriptError) {
            console.error(`[${recordId}] 文字起こし処理エラー:`, transcriptError);
            await prisma.record.update({
              where: { id: recordId },
              data: { 
                status: 'ERROR',
                error: transcriptError instanceof Error ? transcriptError.message : '文字起こし処理中にエラーが発生しました'
              },
            });
            throw transcriptError;
          }
          
        case 3: // 要約からやり直し
          console.log(`[${recordId}] 要約処理を開始します...`);
          if (!record.transcript_text) {
            throw new Error('文字起こし結果がありません。文字起こしから再試行してください。');
          }
          
          // 文字起こし結果をそのまま使用（整形・改善処理を行わない）
          let originalTranscript = record.transcript_text;
          
          try {
            const summary = await this.geminiService.summarizeText(originalTranscript);
            console.log(`[${recordId}] 要約処理が成功しました`);
            
            await prisma.record.update({
              where: { id: recordId },
              data: { summary_text: summary },
            });
            console.log(`[${recordId}] 要約結果をデータベースに保存しました`);
            
            // 記事生成処理に進む
            await this.retryFromStep(recordId, 4);
            return;
          } catch (summaryError) {
            console.error(`[${recordId}] 要約処理エラー:`, summaryError);
            await prisma.record.update({
              where: { id: recordId },
              data: { 
                status: 'ERROR',
                error: summaryError instanceof Error ? summaryError.message : '要約処理中にエラーが発生しました'
              },
            });
            throw summaryError;
          }
          
        case 4: // 記事生成からやり直し
          console.log(`[${recordId}] 記事生成処理を開始します...`);
          if (!record.summary_text) {
            throw new Error('要約結果がありません。要約から再試行してください。');
          }
          
          try {
            const article = await this.claudeService.generateArticle(record.summary_text);
            console.log(`[${recordId}] 記事生成処理が成功しました`);
            
            await prisma.record.update({
              where: { id: recordId },
              data: { 
                article_text: article,
                status: 'DONE'
              },
            });
            console.log(`[${recordId}] 記事生成結果をデータベースに保存しました`);
          } catch (articleError) {
            console.error(`[${recordId}] 記事生成処理エラー:`, articleError);
            await prisma.record.update({
              where: { id: recordId },
              data: { 
                status: 'ERROR',
                error: articleError instanceof Error ? articleError.message : '記事生成処理中にエラーが発生しました'
              },
            });
            throw articleError;
          }
          break;
          
        default:
          throw new Error('無効なステップ番号です');
      }

      console.log(`[${recordId}] ステップ ${step} からの再試行が完了しました`);
    } catch (error) {
      console.error(`ステップ再試行エラー [${recordId}]:`, error);
      throw error;
    }
  }
}
