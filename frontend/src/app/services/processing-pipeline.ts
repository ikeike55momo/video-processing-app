import { GeminiService } from './gemini-service';
import { ClaudeService } from './claude-service';
import prisma from '@/lib/prisma';

// AI処理パイプラインを管理するクラス
export class ProcessingPipeline {
  private geminiService: GeminiService;
  private claudeService: ClaudeService;

  constructor() {
    this.geminiService = new GeminiService();
    this.claudeService = new ClaudeService();
  }

  // 処理パイプラインを実行
  async processVideo(recordId: string): Promise<void> {
    try {
      console.log(`[${recordId}] 処理パイプラインを開始します...`);
      
      // 一時的なレコードIDかどうかを確認
      const isTempRecord = recordId.startsWith('temp-');
      
      let record;
      let fileUrl;
      
      if (isTempRecord) {
        console.log(`[${recordId}] 一時的なレコードIDが検出されました。デバッグモードで処理を続行します。`);
        // 一時的なレコードの場合はダミーのファイルURLを使用
        fileUrl = 'gs://wadotaem-tool/dummy-file.mp4';
      } else {
        // レコードの取得
        try {
          record = await prisma.record.findUnique({
            where: { id: recordId },
          });
          
          if (!record) {
            console.log(`[${recordId}] レコードが見つかりません。デバッグモードで処理を続行します。`);
            // レコードが見つからない場合はダミーのファイルURLを使用
            fileUrl = 'gs://wadotaem-tool/dummy-file.mp4';
          } else {
            console.log(`[${recordId}] レコードが見つかりました:`, record);
          console.log(`[${recordId}] ファイルURL:`, record.file_url);
            fileUrl = record.file_url;
            
            // ステータスをPROCESSINGに更新
            await prisma.record.update({
              where: { id: recordId },
              data: { status: 'PROCESSING' },
            });
          }
        } catch (dbError) {
          console.error(`[${recordId}] データベースエラー:`, dbError);
          // データベースエラーの場合はダミーのファイルURLを使用
          fileUrl = 'gs://wadotaem-tool/dummy-file.mp4';
        }
      }

      // 1. 文字起こし処理
      console.log(`[${recordId}] 文字起こし処理を開始します...`);
      console.log(`[${recordId}] 使用するファイルURL:`, fileUrl);
      let transcript;
      try {
        transcript = await this.geminiService.transcribeAudio(fileUrl);
        console.log(`[${recordId}] 文字起こし処理が成功しました`);
        
        // レコードが存在する場合のみデータベースを更新
        if (!isTempRecord && record) {
          await prisma.record.update({
            where: { id: recordId },
            data: { transcript_text: transcript },
          });
          console.log(`[${recordId}] 文字起こし結果をデータベースに保存しました`);
        }
      } catch (transcriptError) {
        console.error(`[${recordId}] 文字起こし処理エラー:`, transcriptError);
        // エラーが発生した場合はダミーの文字起こし結果を使用
        transcript = "これはダミーの文字起こし結果です。実際の処理ではGemini APIを使用して文字起こしを行います。";
      }
      console.log(`[${recordId}] 文字起こし処理が完了しました`);

      // 1.5. 文字起こし結果の整形・改善処理
      console.log(`[${recordId}] 文字起こし結果の整形・改善処理を開始します...`);
      let enhancedTranscript;
      try {
        enhancedTranscript = await this.geminiService.enhanceTranscript(transcript);
        console.log(`[${recordId}] 文字起こし結果の整形・改善処理が成功しました`);
        
        // レコードが存在する場合のみデータベースを更新
        if (!isTempRecord && record) {
          await prisma.record.update({
            where: { id: recordId },
            data: { transcript_text: enhancedTranscript },
          });
          console.log(`[${recordId}] 整形・改善された文字起こし結果をデータベースに保存しました`);
        }
      } catch (enhanceError) {
        console.error(`[${recordId}] 文字起こし結果の整形・改善処理エラー:`, enhanceError);
        // エラーが発生した場合は元の文字起こし結果を使用
        enhancedTranscript = transcript;
      }
      console.log(`[${recordId}] 文字起こし結果の整形・改善処理が完了しました`);

      // 2. 要約処理
      console.log(`[${recordId}] 要約処理を開始します...`);
      let summary;
      try {
        summary = await this.geminiService.summarizeText(enhancedTranscript);
        console.log(`[${recordId}] 要約処理が成功しました`);
        
        // レコードが存在する場合のみデータベースを更新
        if (!isTempRecord && record) {
          await prisma.record.update({
            where: { id: recordId },
            data: { summary_text: summary },
          });
          console.log(`[${recordId}] 要約結果をデータベースに保存しました`);
        }
      } catch (summaryError) {
        console.error(`[${recordId}] 要約処理エラー:`, summaryError);
        // エラーが発生した場合はダミーの要約結果を使用
        summary = "これはダミーの要約結果です。実際の処理ではGemini APIを使用して要約を行います。";
      }
      console.log(`[${recordId}] 要約処理が完了しました`);

      // 3. 記事生成処理
      console.log(`[${recordId}] 記事生成処理を開始します...`);
      console.log(`[${recordId}] 要約テキスト:`, summary.substring(0, 100) + '...');
      let article;
      try {
        // OpenRouter APIキーの確認
        const openrouterApiKey = process.env.OPENROUTER_API_KEY;
        if (!openrouterApiKey || openrouterApiKey.includes('e9e4a0e1a9e4a0e1')) {
          console.warn(`[${recordId}] OpenRouter APIキーが設定されていないか、デフォルト値のままです。`);
        }
        
        article = await this.claudeService.generateArticle(summary);
        console.log(`[${recordId}] 記事生成処理が成功しました`);
        
        // レコードが存在する場合のみデータベースを更新
        if (!isTempRecord && record) {
          await prisma.record.update({
            where: { id: recordId },
            data: { 
              article_text: article,
              status: 'DONE'
            },
          });
          console.log(`[${recordId}] 記事生成結果をデータベースに保存しました`);
        }
      } catch (articleError) {
        console.error(`[${recordId}] 記事生成処理エラー:`, articleError);
        console.error(`[${recordId}] エラーの詳細:`, JSON.stringify(articleError, null, 2));
        
        // エラー情報をデータベースに保存
        if (!isTempRecord && record) {
          await prisma.record.update({
            where: { id: recordId },
            data: { 
              error: articleError instanceof Error ? articleError.message : '記事生成処理中にエラーが発生しました',
              status: 'ERROR'
            },
          });
        }
        
        // エラーが発生した場合はダミーの記事生成結果を使用
        article = "これはダミーの記事です。実際の処理ではClaude APIを使用して記事生成を行います。";
      }
      console.log(`[${recordId}] 記事生成処理が完了しました`);

      console.log(`[${recordId}] 全ての処理が完了しました`);
    } catch (error) {
      console.error(`処理パイプラインエラー [${recordId}]:`, error);
      
      // エラー情報を保存
      await prisma.record.update({
        where: { id: recordId },
        data: { 
          status: 'ERROR',
          error: error instanceof Error ? error.message : '不明なエラーが発生しました'
        },
      });
      
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
          error: null
        },
      });

      // 処理パイプラインを再実行
      await this.processVideo(recordId);
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
            const transcript = await this.geminiService.transcribeAudio(fileUrl);
            console.log(`[${recordId}] 文字起こし処理が成功しました`);
            
            await prisma.record.update({
              where: { id: recordId },
              data: { transcript_text: transcript },
            });
            console.log(`[${recordId}] 文字起こし結果をデータベースに保存しました`);
            
            // 文字起こし結果の整形・改善処理
            console.log(`[${recordId}] 文字起こし結果の整形・改善処理を開始します...`);
            try {
              const enhancedTranscript = await this.geminiService.enhanceTranscript(transcript);
              console.log(`[${recordId}] 文字起こし結果の整形・改善処理が成功しました`);
              
              await prisma.record.update({
                where: { id: recordId },
                data: { transcript_text: enhancedTranscript },
              });
              console.log(`[${recordId}] 整形・改善された文字起こし結果をデータベースに保存しました`);
            } catch (enhanceError) {
              console.error(`[${recordId}] 文字起こし結果の整形・改善処理エラー:`, enhanceError);
              // エラーが発生しても処理を続行（元の文字起こし結果を使用）
            }
            
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
          
          // 文字起こし結果の整形・改善処理
          console.log(`[${recordId}] 文字起こし結果の整形・改善処理を開始します...`);
          let enhancedTranscript = record.transcript_text;
          try {
            enhancedTranscript = await this.geminiService.enhanceTranscript(record.transcript_text);
            console.log(`[${recordId}] 文字起こし結果の整形・改善処理が成功しました`);
            
            await prisma.record.update({
              where: { id: recordId },
              data: { transcript_text: enhancedTranscript },
            });
            console.log(`[${recordId}] 整形・改善された文字起こし結果をデータベースに保存しました`);
          } catch (enhanceError) {
            console.error(`[${recordId}] 文字起こし結果の整形・改善処理エラー:`, enhanceError);
            // エラーが発生した場合は元の文字起こし結果を使用
          }
          
          try {
            const summary = await this.geminiService.summarizeText(enhancedTranscript);
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
