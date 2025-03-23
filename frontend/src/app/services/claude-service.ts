// OpenRouter APIを使用してClaude Sonnet 3.7と連携するサービスクラス
export class ClaudeService {
  private apiKey: string;
  private apiUrl: string;
  private model: string;

  constructor() {
    // APIキーの取得
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY環境変数が設定されていません');
    }

    this.apiKey = apiKey;
    this.apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    // 最新のモデル名を使用
    this.model = 'anthropic/claude-3.7-sonnet';
  }

  // 要約から記事を生成
  async generateArticle(summary: string): Promise<string> {
    try {
      // デバッグ情報
      console.log('OpenRouter API リクエスト準備:', {
        apiUrl: this.apiUrl,
        model: this.model,
        apiKey: this.apiKey ? '設定済み' : '未設定',
        appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://vpa.ririaru-stg.cloud'
      });

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://vpa.ririaru-stg.cloud',
          'X-Title': 'Video Processing App'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'あなたはSEOに最適化されたブログ記事を作成する専門家です。与えられた要約から、読みやすく情報価値の高い記事を作成してください。'
            },
            {
              role: 'user',
              content: `以下の要約から、SEOに最適化されたブログ記事を作成してください。
              
              ${summary}
              
              記事は以下の要件を満たす必要があります：
              1. 適切な見出し（H2、H3）を使用した構造化された内容
              2. 読者の関心を引く導入部
              3. 要約の重要なポイントを詳細に展開
              4. 実用的なアドバイスや具体例の追加
              5. 読者に行動を促す結論部
              6. 全体で約1500〜2000語の長さ
              
              記事は日本語で作成し、専門用語がある場合は簡潔に説明を加えてください。`
            }
          ]
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('OpenRouter API エラーレスポンス:', {
          status: response.status,
          statusText: response.statusText,
          data: errorData
        });
        throw new Error(`OpenRouter API エラー: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      console.log('OpenRouter API レスポンス成功:', {
        model: data.model,
        usage: data.usage,
        choices: data.choices ? data.choices.length : 0
      });
      
      return data.choices[0].message.content;
    } catch (error) {
      console.error('記事生成エラー:', error);
      throw new Error('記事生成処理に失敗しました: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
}
