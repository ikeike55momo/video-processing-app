// 本番環境のデータベースに直接接続して内容を確認するスクリプト
require('dotenv').config({ path: '.env.prod' });
const { Client } = require('pg');

// データベース接続情報
const connectionString = process.env.DATABASE_URL;
console.log('接続文字列:', connectionString.replace(/\/\/(.+?):.+?@/, '//***:***@')); // パスワードを隠す

// クライアントの作成
const client = new Client({
  connectionString,
  ssl: {
    rejectUnauthorized: false // 自己署名証明書を許可
  }
});

// レコードを取得する関数
async function getRecords() {
  try {
    console.log('データベースに接続中...');
    await client.connect();
    console.log('接続成功！');
    
    // レコード一覧を取得するクエリ
    const result = await client.query(`
      SELECT id, file_url, transcript_text, timestamps_json, summary_text, status, created_at
      FROM records
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `);
    
    console.log(`合計 ${result.rows.length} 件のレコードが見つかりました`);
    
    // レコードの詳細を表示
    result.rows.forEach((record, index) => {
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
          console.log('タイムスタンプの例:');
          if (timestamps.timestamps && timestamps.timestamps.length > 0) {
            console.log(JSON.stringify(timestamps.timestamps.slice(0, 3), null, 2));
          }
        } catch (e) {
          console.log('タイムスタンプの解析に失敗:', e.message);
          console.log('タイムスタンプJSON内容（先頭100文字）:', record.timestamps_json.substring(0, 100) + '...');
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
              console.log('サマリーテキスト内のタイムスタンプの例:');
              if (data.timestamps.length > 0) {
                console.log(JSON.stringify(data.timestamps.slice(0, 3), null, 2));
              }
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
  } finally {
    // 接続を終了
    await client.end();
  }
}

// 特定のレコードの詳細を取得する関数
async function getRecordDetail(id) {
  try {
    console.log(`レコードID ${id} の詳細を取得中...`);
    await client.connect();
    
    // レコードの詳細を取得するクエリ
    const result = await client.query(`
      SELECT id, file_url, transcript_text, timestamps_json, summary_text, status, created_at
      FROM records
      WHERE id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      console.log(`ID ${id} のレコードは見つかりませんでした`);
      return;
    }
    
    const record = result.rows[0];
    
    console.log(`\n--- レコード詳細 ---`);
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
        console.log('タイムスタンプの内容:');
        console.log(JSON.stringify(timestamps, null, 2));
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
      
      // サマリーテキストにタイムスタンプデータが含まれているか確認
      if (record.summary_text.includes('"timestamps"')) {
        console.log('サマリーテキストにタイムスタンプデータが含まれています');
        try {
          const data = JSON.parse(record.summary_text);
          if (data.timestamps) {
            console.log(`サマリーテキスト内のタイムスタンプ数: ${data.timestamps.length}`);
            console.log('サマリーテキスト内のタイムスタンプの内容:');
            console.log(JSON.stringify(data.timestamps, null, 2));
          }
        } catch (e) {
          console.log('サマリーテキスト内のタイムスタンプの解析に失敗:', e.message);
        }
      }
      
      console.log('サマリーテキスト内容（先頭500文字）:', record.summary_text.substring(0, 500) + '...');
    } else {
      console.log('サマリーテキスト: なし');
    }
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    // 接続を終了
    await client.end();
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
