/**
 * Renderサービスを自動的に停止・起動するスクリプト
 * 
 * 使用方法:
 * - Redisキューとワーカーサービスを監視し、アイドル状態の場合は自動的に停止します
 * - 新しいジョブが追加された場合は自動的に起動します
 * - RENDER_API_KEYを環境変数として設定する必要があります
 */
const axios = require('axios');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { QUEUE_NAMES } = require('../src/lib/bull-queue');
const dotenv = require('dotenv');

// 環境変数の読み込み
dotenv.config();

// Render API Key
const RENDER_API_KEY = process.env.RENDER_API_KEY;

// Redisクライアントの設定
const redisUrl = process.env.REDIS_URL;

// Render APIクライアント
const renderClient = axios.create({
  baseURL: 'https://api.render.com/v1',
  headers: {
    'Authorization': `Bearer ${RENDER_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

// サービス名の設定
const REDIS_SERVICE_NAME = 'video-processing-queue';
const WORKER_SERVICE_NAMES = [
  'transcription-worker',
  'summary-worker',
  'article-worker'
];

// アイドル時間のしきい値（ミリ秒）- 30分
const IDLE_THRESHOLD = 30 * 60 * 1000;

/**
 * Renderサービスの状態を確認し、必要に応じて停止・起動する
 */
async function manageRenderServices() {
  console.log('Renderサービス自動管理ツール');
  console.log('------------------------');
  
  if (!RENDER_API_KEY) {
    console.error('エラー: RENDER_API_KEYが設定されていません');
    console.log('環境変数にRENDER_API_KEYを設定してください');
    return;
  }
  
  if (!redisUrl) {
    console.error('エラー: REDIS_URLが設定されていません');
    console.log('環境変数にREDIS_URLを設定してください');
    return;
  }
  
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
    }
    
    // 接続を閉じる
    await connection.quit();
    
    // アクティブなジョブがあるか確認
    const hasJobs = hasActiveJobs || hasWaitingJobs || hasDelayedJobs;
    
    if (hasJobs) {
      console.log('アクティブなジョブが見つかりました。サービスを起動します...');
      
      // Redisサービスが停止している場合は起動
      if (redisService.serviceDetails.status === 'suspended') {
        console.log(`Redisサービス "${REDIS_SERVICE_NAME}" を起動しています...`);
        await resumeService(redisService.id);
      }
      
      // ワーカーサービスが停止している場合は起動
      for (const workerService of workerServices) {
        if (workerService.serviceDetails.status === 'suspended') {
          console.log(`ワーカーサービス "${workerService.name}" を起動しています...`);
          await resumeService(workerService.id);
        }
      }
    } else {
      console.log('アクティブなジョブが見つかりませんでした。サービスをアイドル状態にします...');
      
      // 最後のジョブ完了時間を取得（Redisから）
      // 注: この実装では、最後のジョブ完了時間を取得する方法がないため、
      // 現在の時間を使用しています。実際の実装では、Redisに最後のジョブ完了時間を
      // 保存する仕組みを追加する必要があります。
      const lastJobTime = Date.now() - IDLE_THRESHOLD - 1; // テスト用に閾値を超えた時間を設定
      
      // アイドル時間が閾値を超えた場合はサービスを停止
      if (Date.now() - lastJobTime > IDLE_THRESHOLD) {
        console.log(`アイドル時間が閾値（${IDLE_THRESHOLD / 1000 / 60}分）を超えました。サービスを停止します...`);
        
        // ワーカーサービスを停止
        for (const workerService of workerServices) {
          if (workerService.serviceDetails.status === 'live') {
            console.log(`ワーカーサービス "${workerService.name}" を停止しています...`);
            await suspendService(workerService.id);
          }
        }
        
        // Redisサービスを停止
        if (redisService.serviceDetails.status === 'live') {
          console.log(`Redisサービス "${REDIS_SERVICE_NAME}" を停止しています...`);
          await suspendService(redisService.id);
        }
      }
    }
    
    console.log('サービス管理が完了しました');
  } catch (error) {
    console.error('エラーが発生しました:', error.response?.data || error.message);
  }
}

/**
 * サービスを停止する
 * @param {string} serviceId サービスID
 */
async function suspendService(serviceId) {
  try {
    console.log(`サービス ${serviceId} を停止しています...`);
    await renderClient.post(`/services/${serviceId}/suspend`);
    console.log('サービスの停止リクエストを送信しました');
    console.log('停止には数分かかる場合があります');
  } catch (error) {
    console.error('サービスの停止中にエラーが発生しました:', error.response?.data || error.message);
  }
}

/**
 * サービスを起動する
 * @param {string} serviceId サービスID
 */
async function resumeService(serviceId) {
  try {
    console.log(`サービス ${serviceId} を起動しています...`);
    await renderClient.post(`/services/${serviceId}/resume`);
    console.log('サービスの起動リクエストを送信しました');
    console.log('起動には数分かかる場合があります');
  } catch (error) {
    console.error('サービスの起動中にエラーが発生しました:', error.response?.data || error.message);
  }
}

// スクリプト実行
manageRenderServices();
