// 本番環境のデータを取得するスクリプト
require('dotenv').config({ path: '.env.local' });
const https = require('https');

// 本番環境のURL
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://video-processing-api.onrender.com';

// APIからデータを取得する関数
function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      
      // データを受信
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      // データ受信完了
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          resolve(parsedData);
        } catch (e) {
          reject(new Error(`データの解析に失敗しました: ${e.message}`));
        }
      });
      
    }).on('error', (err) => {
      reject(new Error(`リクエストエラー: ${err.message}`));
    });
  });
}

// レコード一覧を取得
async function getRecords() {
  try {
    console.log(`レコード一覧を取得中... (${API_URL}/api/records)`);
    const data = await fetchData(`${API_URL}/api/records`);
    
    if (!data || !data.records) {
      throw new Error('レコードデータが見つかりません');
    }
    
    console.log(`合計 ${data.records.length} 件のレコードが見つかりました`);
    
    // レコードの詳細を表示
    data.records.forEach((record, index) => {
      console.log(`\n--- レコード ${index + 1} ---`);
      console.log(`ID: ${record.id}`);
      console.log(`ファイルURL: ${record.file_url}`);
      console.log(`ステータス: ${record.status}`);
      console.log(`作成日時: ${record.created_at}`);
      
      // タイムスタンプの確認
      if (record.timestamps_json) {
        console.log('タイムスタンプ: あり');
        try {
          const timestamps = JSON.parse(record.timestamps_json);
          console.log(`タイムスタンプ数: ${timestamps.timestamps ? timestamps.timestamps.length : 0}`);
        } catch (e) {
          console.log('タイムスタンプの解析に失敗:', e.message);
          console.log('タイムスタンプJSON内容:', record.timestamps_json);
        }
      } else {
        console.log('タイムスタンプ: なし');
      }
      
      // サマリーテキストの確認
      if (record.summary_text) {
        console.log('サマリーテキスト: あり');
        console.log('サマリーテキスト内容（先頭100文字）:', record.summary_text.substring(0, 100) + '...');
        
        // サマリーテキストにタイムスタンプデータが含まれているか確認
        if (record.summary_text.includes('"timestamps"')) {
          console.log('サマリーテキストにタイムスタンプデータが含まれています');
          try {
            const data = JSON.parse(record.summary_text);
            if (data.timestamps) {
              console.log(`サマリーテキスト内のタイムスタンプ数: ${data.timestamps.length}`);
            }
          } catch (e) {
            console.log('サマリーテキスト内のタイムスタンプの解析に失敗:', e.message);
          }
        }
      } else {
        console.log('サマリーテキスト: なし');
      }
    });
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// 特定のレコードの詳細を取得
async function getRecordDetail(id) {
  try {
    console.log(`レコードID ${id} の詳細を取得中...`);
    const record = await fetchData(`${API_URL}/api/records/${id}`);
    
    console.log(`\n--- レコード詳細 ---`);
    console.log(JSON.stringify(record, null, 2));
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// メイン関数
async function main() {
  // コマンドライン引数からレコードIDを取得
  const recordId = process.argv[2];
  
  if (recordId) {
    // 特定のレコードの詳細を取得
    await getRecordDetail(recordId);
  } else {
    // 全レコードを取得
    await getRecords();
  }
}

// スクリプトを実行
main();
