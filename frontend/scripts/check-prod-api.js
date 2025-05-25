// 本番環境のAPIからデータを取得するスクリプト
import 'dotenv/config';
import fetch from 'node-fetch';

// 本番環境のAPI URL
const API_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vpa.ririaru-stg.cloud';

async function fetchRecords() {
  try {
    console.log(`本番環境のAPIからレコードを取得中... (${API_URL}/api/records)`);
    
    const response = await fetch(`${API_URL}/api/records`);
    
    if (!response.ok) {
      throw new Error(`APIエラー: ${response.status} ${response.statusText}`);
    }
    
    const records = await response.json();
    
    console.log(`合計 ${records.length} 件のレコードが見つかりました`);
    
    // レコードの詳細を表示
    records.forEach((record, index) => {
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

// 特定のレコードの詳細を取得する関数
async function fetchRecordDetail(id) {
  try {
    console.log(`レコードID ${id} の詳細を取得中...`);
    
    const response = await fetch(`${API_URL}/api/records/${id}`);
    
    if (!response.ok) {
      throw new Error(`APIエラー: ${response.status} ${response.statusText}`);
    }
    
    const record = await response.json();
    
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
    await fetchRecordDetail(recordId);
  } else {
    // 全レコードを取得
    await fetchRecords();
  }
}

main();
