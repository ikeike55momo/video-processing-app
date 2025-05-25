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

      // 1. 高精度文字起こし処理
      console.log(`[${recordId}] 高精度文字起こし処理を開始します...`);
      console.log(`[${recordId}] 使用するファイルURL:`, fileUrl);
      
      let transcript = '';
      try {
        // バックエンドAPIを使用して文字起こし
        const apiUrl = `https://video-processing-api.onrender.com/api/transcribe`;
        console.log(`[${recordId}] バックエンドAPIを使用して文字起こし: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileUrl }),
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`バックエンドAPIエラー: ${response.status} ${errorText}`);
        }
        
        const data = await response.json();
        transcript = data.transcript;
        
        if (!transcript || transcript.trim() === '') {
          throw new Error('文字起こし結果が空です');
        }
        
        // 文字起こし結果をデータベースに保存
        await prisma.record.update({
          where: { id: recordId },
          data: { transcript_text: transcript },
        });
        console.log(`[${recordId}] 文字起こし結果をデータベースに保存しました`);
      } catch (transcriptionError) {
        console.error(`[${recordId}] 文字起こし処理エラー:`, transcriptionError);
        
        // フォールバック: 従来のGemini文字起こしを試行
        console.log(`[${recordId}] フォールバック: 従来のGemini文字起こしを試行します...`);
        
        try {
          transcript = await this.transcriptionService.transcribeFile(fileUrl);
          
          // 文字起こし結果をデータベースに保存
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
      console.log(`[${recordId}] 文字起こし結果: ${transcript.substring(0, 100)}...`);
      
      // 文字起こし結果をそのまま使用（整形・改善処理を行わない）
      let originalTranscript = transcript;
      
      console.log(`[${recordId}] 文字起こし結果: ${originalTranscript.substring(0, 100)}...`);
      
      // 2. タイムスタンプ抽出処理
      console.log(`[${recordId}] タイムスタンプ抽出処理を開始します...`);
      let timestampsData;
      try {
        // タイムスタンプ抽出用のプロンプトを作成
        const timestampPrompt = `
あなたはプロのタイムスタンプ作成者です。以下の文字起こしテキストを分析し、YouTubeのようなタイムスタンプを作成してください。

## 指示
1. 文字起こしテキストを分析し、重要なトピックの変わり目、主要なポイント、話題の転換点を特定してください
2. 各ポイントの開始時間（秒単位）とその内容の要約を抽出してください
3. 最初のタイムスタンプは必ず0秒から始めてください
4. 結果は以下のJSON形式で返してください:

\`\`\`json
{
  "timestamps": [
    {
      "time": 0,
      "text": "導入部分の内容"
    },
    {
      "time": 120,
      "text": "次のトピックの内容"
    },
    ...
  ]
}
\`\`\`

## 重要な注意点
- 時間は秒単位の数値で指定してください（例: 65.5）
- 各ポイントの要約は簡潔に、30文字程度にしてください
- 重要なポイントを10〜15個程度抽出してください
- タイムスタンプは均等に分布させてください（例: 2分程度の動画なら15〜30秒ごと）
- 文字起こしの内容に基づいて、実際の動画内容を反映したタイムスタンプを作成してください
- JSONのみを返してください。説明文は不要です

## 文字起こしテキスト:
${originalTranscript}
`;

        // Gemini APIを使用してタイムスタンプを抽出
        const timestampResponse = await this.geminiService.extractTimestamps(timestampPrompt);
        console.log(`[${recordId}] タイムスタンプ抽出が成功しました`);
        
        // JSONを抽出
        let jsonMatch = timestampResponse.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch) {
          // JSONブロックがない場合は、テキスト全体をJSONとして解析を試みる
          jsonMatch = [timestampResponse, timestampResponse.trim()];
        }
        
        try {
          timestampsData = JSON.parse(jsonMatch && jsonMatch[1] ? jsonMatch[1] : '{"timestamps":[]}');
          console.log(`[${recordId}] 抽出されたタイムスタンプ: ${timestampsData.timestamps.length}個`);
          
          // タイムスタンプをデータベースに保存
          console.log(`[${recordId}] タイムスタンプ保存前のデータ:`, JSON.stringify(timestampsData).substring(0, 100) + '...');
          
          // 保存前のレコード状態を確認
          const recordBefore = await prisma.record.findUnique({
            where: { id: recordId },
          });
          console.log(`[${recordId}] 保存前のレコード状態:`, {
            id: recordBefore?.id,
            summary_text: recordBefore?.summary_text ? recordBefore.summary_text.substring(0, 50) + '...' : null,
            status: recordBefore?.status
          });
          
          await prisma.record.update({
            where: { id: recordId },
            data: { 
              timestamps_json: JSON.stringify(timestampsData) 
            },
          });
          
          // 保存後のレコード状態を確認
          const recordAfter = await prisma.record.findUnique({
            where: { id: recordId },
          });
          console.log(`[${recordId}] 保存後のレコード状態:`, {
            id: recordAfter?.id,
            summary_text: recordAfter?.summary_text ? recordAfter.summary_text.substring(0, 50) + '...' : null,
            status: recordAfter?.status
          });
          
          console.log(`[${recordId}] タイムスタンプをデータベースに保存しました（データ:`, JSON.stringify(timestampsData).substring(0, 100) + '...');
        } catch (parseError) {
          console.error(`[${recordId}] タイムスタンプJSONの解析に失敗しました:`, parseError);
          console.log(`[${recordId}] 生のレスポンス:`, timestampResponse);
          
          // 空のタイムスタンプ配列を作成
          timestampsData = { timestamps: [] };
          
          // 空のタイムスタンプをデータベースに保存
          console.log(`[${recordId}] タイムスタンプ保存前のデータ:`, JSON.stringify(timestampsData).substring(0, 100) + '...');
          
          // 保存前のレコード状態を確認
          const recordBefore = await prisma.record.findUnique({
            where: { id: recordId },
          });
          console.log(`[${recordId}] 保存前のレコード状態:`, {
            id: recordBefore?.id,
            summary_text: recordBefore?.summary_text ? recordBefore.summary_text.substring(0, 50) + '...' : null,
            status: recordBefore?.status
          });
          
          await prisma.record.update({
            where: { id: recordId },
            data: { 
              timestamps_json: JSON.stringify(timestampsData) 
            },
          });
          
          // 保存後のレコード状態を確認
          const recordAfter = await prisma.record.findUnique({
            where: { id: recordId },
          });
          console.log(`[${recordId}] 保存後のレコード状態:`, {
            id: recordAfter?.id,
            summary_text: recordAfter?.summary_text ? recordAfter.summary_text.substring(0, 50) + '...' : null,
            status: recordAfter?.status
          });
          
          console.log(`[${recordId}] 空のタイムスタンプをデータベースに保存しました（データ:`, JSON.stringify(timestampsData));
        }
      } catch (timestampError) {
        console.error(`[${recordId}] タイムスタンプ抽出処理エラー:`, timestampError);
        
        // エラー時は空のタイムスタンプ配列を作成
        timestampsData = { timestamps: [] };
        
        // 空のタイムスタンプをデータベースに保存
        console.log(`[${recordId}] タイムスタンプ保存前のデータ:`, JSON.stringify(timestampsData).substring(0, 100) + '...');
        
        // 保存前のレコード状態を確認
        const recordBefore = await prisma.record.findUnique({
          where: { id: recordId },
        });
        console.log(`[${recordId}] 保存前のレコード状態:`, {
          id: recordBefore?.id,
          summary_text: recordBefore?.summary_text ? recordBefore.summary_text.substring(0, 50) + '...' : null,
          status: recordBefore?.status
        });
        
        await prisma.record.update({
          where: { id: recordId },
          data: { 
            timestamps_json: JSON.stringify(timestampsData) 
          },
        });
        
        // 保存後のレコード状態を確認
        const recordAfter = await prisma.record.findUnique({
          where: { id: recordId },
        });
        console.log(`[${recordId}] 保存後のレコード状態:`, {
          id: recordAfter?.id,
          summary_text: recordAfter?.summary_text ? recordAfter.summary_text.substring(0, 50) + '...' : null,
          status: recordAfter?.status
        });
        
        console.log(`[${recordId}] エラー発生のため空のタイムスタンプをデータベースに保存しました（データ:`, JSON.stringify(timestampsData));
        
        // タイムスタンプ抽出エラーは致命的ではないため、処理を続行
        console.log(`[${recordId}] タイムスタンプ抽出エラーが発生しましたが、処理を続行します`);
      }
      console.log(`[${recordId}] タイムスタンプ抽出処理が完了しました`);
      
      // 3. 要約処理
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

      // 4. 記事生成処理
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
            let transcript = '';
            try {
              // バックエンドAPIを使用して文字起こし
              const apiUrl = `https://video-processing-api.onrender.com/api/transcribe`;
              console.log(`[${recordId}] バックエンドAPIを使用して文字起こし: ${apiUrl}`);
              
              const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ fileUrl }),
              });
              
              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`バックエンドAPIエラー: ${response.status} ${errorText}`);
              }
              
              const data = await response.json();
              transcript = data.transcript;
              
              if (!transcript || transcript.trim() === '') {
                throw new Error('文字起こし結果が空です');
              }
              
              // 文字起こし結果をデータベースに保存
              await prisma.record.update({
                where: { id: recordId },
                data: { transcript_text: transcript },
              });
              console.log(`[${recordId}] 文字起こし結果をデータベースに保存しました`);
            } catch (transcriptionError) {
              console.error(`[${recordId}] 文字起こし処理エラー:`, transcriptionError);
              
              // フォールバック: 従来のGemini文字起こしを試行
              console.log(`[${recordId}] フォールバック: 従来のGemini文字起こしを試行します...`);
              
              try {
                transcript = await this.transcriptionService.transcribeFile(fileUrl);
                
                // 文字起こし結果をデータベースに保存
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
            console.log(`[${recordId}] 文字起こし結果: ${transcript.substring(0, 100)}...`);
            
            // 文字起こし結果をそのまま使用（整形・改善処理を行わない）
            let originalTranscript = transcript;
            
            console.log(`[${recordId}] 文字起こし結果: ${originalTranscript.substring(0, 100)}...`);
            
            // タイムスタンプ抽出処理に進む
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
          
        case 3: // タイムスタンプ抽出からやり直し
          console.log(`[${recordId}] タイムスタンプ抽出処理を開始します...`);
          try {
            // 文字起こし結果を取得
            const record = await prisma.record.findUnique({
              where: { id: recordId },
            });
            
            if (!record || !record.transcript_text) {
              throw new Error('文字起こし結果がありません。文字起こしから再試行してください。');
            }
            
            const originalTranscript = record.transcript_text;
            
            // タイムスタンプ抽出用のプロンプトを作成
            const timestampPrompt = `
あなたはプロのタイムスタンプ作成者です。以下の文字起こしテキストを分析し、YouTubeのようなタイムスタンプを作成してください。

## 指示
1. 文字起こしテキストを分析し、重要なトピックの変わり目、主要なポイント、話題の転換点を特定してください
2. 各ポイントの開始時間（秒単位）とその内容の要約を抽出してください
3. 最初のタイムスタンプは必ず0秒から始めてください
4. 結果は以下のJSON形式で返してください:

\`\`\`json
{
  "timestamps": [
    {
      "time": 0,
      "text": "導入部分の内容"
    },
    {
      "time": 120,
      "text": "次のトピックの内容"
    },
    ...
  ]
}
\`\`\`

## 重要な注意点
- 時間は秒単位の数値で指定してください（例: 65.5）
- 各ポイントの要約は簡潔に、30文字程度にしてください
- 重要なポイントを10〜15個程度抽出してください
- タイムスタンプは均等に分布させてください（例: 2分程度の動画なら15〜30秒ごと）
- 文字起こしの内容に基づいて、実際の動画内容を反映したタイムスタンプを作成してください
- JSONのみを返してください。説明文は不要です

## 文字起こしテキスト:
${originalTranscript}
`;

            // Gemini APIを使用してタイムスタンプを抽出
            const timestampResponse = await this.geminiService.extractTimestamps(timestampPrompt);
            console.log(`[${recordId}] タイムスタンプ抽出が成功しました`);
            
            // JSONを抽出
            let jsonMatch = timestampResponse.match(/```json\s*([\s\S]*?)\s*```/);
            if (!jsonMatch) {
              // JSONブロックがない場合は、テキスト全体をJSONとして解析を試みる
              jsonMatch = [timestampResponse, timestampResponse.trim()];
            }
            
            try {
              const timestampsData = JSON.parse(jsonMatch && jsonMatch[1] ? jsonMatch[1] : '{"timestamps":[]}');
              console.log(`[${recordId}] 抽出されたタイムスタンプ: ${timestampsData.timestamps.length}個`);
              
              // タイムスタンプをデータベースに保存
              console.log(`[${recordId}] タイムスタンプ保存前のデータ:`, JSON.stringify(timestampsData).substring(0, 100) + '...');
              
              // 保存前のレコード状態を確認
              const recordBefore = await prisma.record.findUnique({
                where: { id: recordId },
              });
              console.log(`[${recordId}] 保存前のレコード状態:`, {
                id: recordBefore?.id,
                summary_text: recordBefore?.summary_text ? recordBefore.summary_text.substring(0, 50) + '...' : null,
                status: recordBefore?.status
              });
              
              await prisma.record.update({
                where: { id: recordId },
                data: { 
                  timestamps_json: JSON.stringify(timestampsData) 
                },
              });
              
              // 保存後のレコード状態を確認
              const recordAfter = await prisma.record.findUnique({
                where: { id: recordId },
              });
              console.log(`[${recordId}] 保存後のレコード状態:`, {
                id: recordAfter?.id,
                summary_text: recordAfter?.summary_text ? recordAfter.summary_text.substring(0, 50) + '...' : null,
                status: recordAfter?.status
              });
              
              console.log(`[${recordId}] タイムスタンプをデータベースに保存しました（データ:`, JSON.stringify(timestampsData).substring(0, 100) + '...');
            } catch (parseError) {
              console.error(`[${recordId}] タイムスタンプJSONの解析に失敗しました:`, parseError);
              console.log(`[${recordId}] 生のレスポンス:`, timestampResponse);
              
              // 空のタイムスタンプ配列を作成
              const timestampsData = { timestamps: [] };
              
              // 空のタイムスタンプをデータベースに保存
              console.log(`[${recordId}] タイムスタンプ保存前のデータ:`, JSON.stringify(timestampsData).substring(0, 100) + '...');
              
              // 保存前のレコード状態を確認
              const recordBefore = await prisma.record.findUnique({
                where: { id: recordId },
              });
              console.log(`[${recordId}] 保存前のレコード状態:`, {
                id: recordBefore?.id,
                summary_text: recordBefore?.summary_text ? recordBefore.summary_text.substring(0, 50) + '...' : null,
                status: recordBefore?.status
              });
              
              await prisma.record.update({
                where: { id: recordId },
                data: { 
                  timestamps_json: JSON.stringify(timestampsData) 
                },
              });
              
              // 保存後のレコード状態を確認
              const recordAfter = await prisma.record.findUnique({
                where: { id: recordId },
              });
              console.log(`[${recordId}] 保存後のレコード状態:`, {
                id: recordAfter?.id,
                summary_text: recordAfter?.summary_text ? recordAfter.summary_text.substring(0, 50) + '...' : null,
                status: recordAfter?.status
              });
              
              console.log(`[${recordId}] 空のタイムスタンプをデータベースに保存しました（データ:`, JSON.stringify(timestampsData));
            }
          } catch (timestampError) {
            console.error(`[${recordId}] タイムスタンプ抽出処理エラー:`, timestampError);
            
            // エラー時は空のタイムスタンプ配列を作成
            const timestampsData = { timestamps: [] };
            
            // 空のタイムスタンプをデータベースに保存
            console.log(`[${recordId}] タイムスタンプ保存前のデータ:`, JSON.stringify(timestampsData).substring(0, 100) + '...');
            
            // 保存前のレコード状態を確認
            const recordBefore = await prisma.record.findUnique({
              where: { id: recordId },
            });
            console.log(`[${recordId}] 保存前のレコード状態:`, {
              id: recordBefore?.id,
              summary_text: recordBefore?.summary_text ? recordBefore.summary_text.substring(0, 50) + '...' : null,
              status: recordBefore?.status
            });
            
            await prisma.record.update({
              where: { id: recordId },
              data: { 
                timestamps_json: JSON.stringify(timestampsData) 
              },
            });
            
            // 保存後のレコード状態を確認
            const recordAfter = await prisma.record.findUnique({
              where: { id: recordId },
            });
            console.log(`[${recordId}] 保存後のレコード状態:`, {
              id: recordAfter?.id,
              summary_text: recordAfter?.summary_text ? recordAfter.summary_text.substring(0, 50) + '...' : null,
              status: recordAfter?.status
            });
            
            console.log(`[${recordId}] エラー発生のため空のタイムスタンプをデータベースに保存しました（データ:`, JSON.stringify(timestampsData));
            
            // タイムスタンプ抽出エラーは致命的ではないため、処理を続行
            console.log(`[${recordId}] タイムスタンプ抽出エラーが発生しましたが、処理を続行します`);
          }
          console.log(`[${recordId}] タイムスタンプ抽出処理が完了しました`);
          
          // 要約処理に進む
          await this.retryFromStep(recordId, 4);
          return;
          
        case 4: // 要約からやり直し
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
            await this.retryFromStep(recordId, 5);
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
          
        case 5: // 記事生成からやり直し
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
