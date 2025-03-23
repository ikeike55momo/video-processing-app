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
              
              記事は以下の要件を満たしてください：
              1. 適切な見出し（H2、H3）を使用し、構造化された内容にする
              2. 読者が求める情報を網羅する
              3. 専門用語は適宜説明する
              4. 読みやすい文章で、一般読者にもわかりやすい表現を使用する
              5. 記事の長さは2000〜3000文字程度
              6. マークダウン形式で出力する
              
              記事のタイトルは内容を反映した魅力的なものにしてください。`
            }
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('OpenRouter APIエラー:', errorData);
        throw new Error(`OpenRouter APIエラー: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('OpenRouter API レスポンス:', {
        status: response.status,
        model: data.model,
        usage: data.usage
      });

      const article = data.choices[0].message.content;
      return article;
    } catch (error) {
      console.error('記事生成中にエラーが発生しました:', error);
      throw error;
    }
  }
}
