/**
 * Renderサービスを管理するためのライブラリ
 * APIサービスからRedisキューとワーカーサービスを自動的に停止・起動するための機能を提供します
 */
const axios = require('axios');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { QUEUE_NAMES } = require('./bull-queue');

// サービス名の設定
const REDIS_SERVICE_NAME = 'video-processing-queue';
const WORKER_SERVICE_NAMES = [
  'transcription-worker',
  'summary-worker',
  'article-worker'
];

// アイドル時間のしきい値（ミリ秒）- 30分
const IDLE_THRESHOLD = 30 * 60 * 1000;

// Redisキー
const LAST_JOB_TIME_KEY = 'app:lastJobTime';

/**
 * 最後のジョブ完了時間をRedisに保存する
 * @param {IORedis.Redis} redisClient Redisクライアント
 */
async function updateLastJobTime(redisClient) {
  const now = Date.now();
  await redisClient.set(LAST_JOB_TIME_KEY, now.toString());
  console.log(`最後のジョブ完了時間をRedisに保存しました: ${new Date(now).toISOString()}`);
}

/**
 * Renderサービスの状態を確認し、必要に応じて停止・起動する
 * @param {string} renderApiKey Render API Key
 * @param {string} redisUrl Redis URL
 * @returns {Promise<void>}
 */
async function manageRenderServices(renderApiKey, redisUrl) {
  if (!renderApiKey) {
    console.error('エラー: RENDER_API_KEYが設定されていません');
    return;
  }
  
  if (!redisUrl) {
    console.error('エラー: REDIS_URLが設定されていません');
    return;
  }
  
  // Render APIクライアント
  const renderClient = axios.create({
    baseURL: 'https://api.render.com/v1',
    headers: {
      'Authorization': `Bearer ${renderApiKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  try {
    // サービス一覧を取得
    console.log('Renderサービスを取得しています...');
    const response = await renderClient.get('/services');
    const services = response.data;
    
    if (services.length === 0) {
      console.log('サービスが見つかりませんでした');
      return;
    }
    
    // Redisサービスを検索
    const redisService = services.find(service => service.name === REDIS_SERVICE_NAME);
    if (!redisService) {
      console.log(`Redisサービス "${REDIS_SERVICE_NAME}" が見つかりませんでした`);
      return;
    }
    
    // ワーカーサービスを検索
    const workerServices = services.filter(service => 
      WORKER_SERVICE_NAMES.includes(service.name)
    );
    
    if (workerServices.length === 0) {
      console.log('ワーカーサービスが見つかりませんでした');
      return;
    }
    
    // Redisに接続
    console.log('Redisに接続しています...');
    const connection = new IORedis(redisUrl);
    
    // すべてのキューのアクティビティをチェック
    let hasActiveJobs = false;
    let hasWaitingJobs = false;
    let hasDelayedJobs = false;
    
    for (const queueName of Object.values(QUEUE_NAMES)) {
      const queue = new Queue(queueName, { connection });
      
      // キューの状態を取得
      const jobCounts = await queue.getJobCounts('active', 'waiting', 'delayed');
      console.log(`${queueName}キューの状態:`);
      console.log(` - アクティブ: ${jobCounts.active}`);
      console.log(` - 待機中: ${jobCounts.waiting}`);
      console.log(` - 遅延: ${jobCounts.delayed}`);
      
      // アクティブなジョブがあるか確認
      if (jobCounts.active > 0) {
        hasActiveJobs = true;
      }
      
      // 待機中のジョブがあるか確認
      if (jobCounts.waiting > 0) {
        hasWaitingJobs = true;
      }
      
      // 遅延ジョブがあるか確認
      if (jobCounts.delayed > 0) {
        hasDelayedJobs = true;
      }
      
      // キューを閉じる
      await queue.close();
    }
    
    // 最後のジョブ完了時間をRedisから取得
    const lastJobTimeString = await connection.get(LAST_JOB_TIME_KEY);
    const lastJobTime = lastJobTimeString ? parseInt(lastJobTimeString, 10) : Date.now(); // 取得できない場合は現在時刻
    
    // 接続を閉じる
    await connection.quit();
    
    // アクティブなジョブがあるか確認
    const hasJobs = hasActiveJobs || hasWaitingJobs || hasDelayedJobs;
    
    if (hasJobs) {
      console.log('アクティブなジョブが見つかりました。サービスを起動します...');
      
      // Redisサービスが停止している場合は起動
      if (redisService.serviceDetails.status === 'suspended') {
        console.log(`Redisサービス "${REDIS_SERVICE_NAME}" を起動しています...`);
        await resumeService(renderClient, redisService.id);
      }
      
      // ワーカーサービスが停止している場合は起動
      for (const workerService of workerServices) {
        if (workerService.serviceDetails.status === 'suspended') {
          console.log(`ワーカーサービス "${workerService.name}" を起動しています...`);
          await resumeService(renderClient, workerService.id);
        }
      }
      
      // 最後のジョブ完了時間を更新 (ジョブがある場合は現在時刻に更新)
      const redisClientForUpdate = new IORedis(redisUrl);
      await updateLastJobTime(redisClientForUpdate);
      await redisClientForUpdate.quit();
      
    } else {
      console.log('アクティブなジョブが見つかりませんでした。アイドル状態を確認します...');
      console.log(`最後のジョブ完了時間 (Redisから取得): ${new Date(lastJobTime).toISOString()}`);
      console.log(`現在の時間: ${new Date().toISOString()}`);
      const idleDuration = Date.now() - lastJobTime;
      console.log(`経過時間: ${Math.floor(idleDuration / 1000 / 60)}分`);
      
      // アイドル時間が閾値を超えた場合はサービスを停止
      if (idleDuration > IDLE_THRESHOLD) {
        console.log(`アイドル時間が閾値（${IDLE_THRESHOLD / 1000 / 60}分）を超えました。サービスを停止します...`);
        
        // ワーカーサービスを停止
        for (const workerService of workerServices) {
          if (workerService.serviceDetails.status === 'live') {
            console.log(`ワーカーサービス "${workerService.name}" を停止しています...`);
            await suspendService(renderClient, workerService.id);
          }
        }
        
        // Redisサービスを停止
        if (redisService.serviceDetails.status === 'live') {
          console.log(`Redisサービス "${REDIS_SERVICE_NAME}" を停止しています...`);
          await suspendService(renderClient, redisService.id);
        }
      } else {
        console.log(`アイドル時間が閾値（${IDLE_THRESHOLD / 1000 / 60}分）を超えていないため、サービスを維持します`);
      }
    }
    
    console.log('サービス管理が完了しました');
  } catch (error) {
    console.error('エラーが発生しました:', error.response?.data || error.message);
  }
}

/**
 * サービスを停止する
 * @param {Object} renderClient Render APIクライアント
 * @param {string} serviceId サービスID
 */
async function suspendService(renderClient, serviceId) {
  try {
    console.log(`サービス ${serviceId} を停止しています...`);
    await renderClient.post(`/services/${serviceId}/suspend`);
    console.log('サービスの停止リクエストを送信しました');
  } catch (error) {
    console.error('サービスの停止中にエラーが発生しました:', error.response?.data || error.message);
  }
}

/**
 * サービスを起動する
 * @param {Object} renderClient Render APIクライアント
 * @param {string} serviceId サービスID
 */
async function resumeService(renderClient, serviceId) {
  try {
    console.log(`サービス ${serviceId} を起動しています...`);
    await renderClient.post(`/services/${serviceId}/resume`);
    console.log('サービスの起動リクエストを送信しました');
  } catch (error) {
    console.error('サービスの起動中にエラーが発生しました:', error.response?.data || error.message);
  }
}

module.exports = {
  manageRenderServices,
  updateLastJobTime
};
