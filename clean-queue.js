// キューのクリーンアップスクリプト
require('dotenv').config();
const { createClient } = require('redis');

async function cleanQueue() {
  try {
    const redisUrl = process.env.REDIS_URL || '';
    console.log('Redis URL:', redisUrl.replace(/:[^:]*@/, ':***@'));
    
    if (!redisUrl) {
      console.error('REDIS_URL環境変数が設定されていません');
      return;
    }
    
    console.log('Redisに接続しています...');
    const client = createClient({
      url: redisUrl
    });
    
    client.on('error', err => {
      console.error('Redis接続エラー:', err);
    });
    
    await client.connect();
    console.log('Redisに接続しました');
    
    // キューの情報を取得
    const keys = await client.keys('*');
    console.log('存在するキー:', keys);
    
    // transcriptionキューをクリア
    const queueLength = await client.lLen('transcription');
    console.log('transcriptionキューの長さ:', queueLength);
    
    if (queueLength > 0) {
      console.log('transcriptionキューをクリアします...');
      await client.del('transcription');
      console.log('transcriptionキューをクリアしました');
    }
    
    // 処理中キューもクリア
    const processingQueueLength = await client.lLen('transcription:processing');
    console.log('transcription:processingキューの長さ:', processingQueueLength);
    
    if (processingQueueLength > 0) {
      console.log('transcription:processingキューをクリアします...');
      await client.del('transcription:processing');
      console.log('transcription:processingキューをクリアしました');
    }
    
    // 再度キューの情報を確認
    const updatedKeys = await client.keys('*');
    console.log('クリーンアップ後のキー:', updatedKeys);
    
    await client.quit();
    console.log('Redisとの接続を終了しました');
  } catch (error) {
    console.error('クリーンアップ中にエラーが発生しました:', error);
  }
}

cleanQueue();
