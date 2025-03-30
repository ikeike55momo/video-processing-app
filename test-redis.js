// Redis接続テスト用スクリプト
require('dotenv').config();
const { createClient } = require('redis');

async function testRedis() {
  try {
    // 接続URLをマスクして表示（セキュリティのため）
    const redisUrl = process.env.REDIS_URL || '';
    console.log('Redis URL:', redisUrl.replace(/:[^:]*@/, ':***@'));
    
    if (!redisUrl) {
      console.error('REDIS_URL環境変数が設定されていません');
      return;
    }
    
    console.log('Redisに接続を試みています...');
    const client = createClient({
      url: redisUrl
    });
    
    client.on('error', err => {
      console.error('Redis接続エラー:', err);
    });
    
    await client.connect();
    console.log('Redisに接続しました！');
    
    // 簡単なテスト操作
    const testKey = 'test-' + Date.now();
    await client.set(testKey, 'テスト値');
    console.log(`キー "${testKey}" を設定しました`);
    
    const value = await client.get(testKey);
    console.log(`キー "${testKey}" の値: ${value}`);
    
    // キューの情報を取得
    const keys = await client.keys('*');
    console.log('存在するキー:', keys);
    
    // transcriptionキューの長さを確認
    const queueLength = await client.lLen('transcription');
    console.log('transcriptionキューの長さ:', queueLength);
    
    if (queueLength > 0) {
      // キューの先頭を確認（取り出さずに）
      const firstJob = await client.lIndex('transcription', 0);
      console.log('キュー内の最初のジョブ:', firstJob ? JSON.parse(firstJob) : null);
    }
    
    await client.quit();
    console.log('Redisとの接続を終了しました');
  } catch (error) {
    console.error('テスト実行中にエラーが発生しました:', error);
  }
}

testRedis();
