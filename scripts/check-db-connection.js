// PostgreSQL接続テスト用スクリプト
const { Client } = require('pg');
require('dotenv').config();

async function testConnection() {
  console.log('PostgreSQL接続テストを開始します...');
  
  // 接続文字列からSSLモードを確認
  const connectionString = process.env.DATABASE_URL;
  console.log(`接続文字列: ${connectionString}`);
  
  const hasSSL = connectionString.includes('sslmode=');
  console.log(`SSL設定: ${hasSSL ? '有効' : '無効'}`);
  
  // クライアント設定
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false // 自己署名証明書を許可
    }
  });

  try {
    console.log('接続を試みています...');
    await client.connect();
    console.log('接続成功！');
    
    // データベース情報を取得
    const dbResult = await client.query('SELECT current_database(), current_schema()');
    console.log('データベース情報:');
    console.log(`- データベース名: ${dbResult.rows[0].current_database}`);
    console.log(`- 現在のスキーマ: ${dbResult.rows[0].current_schema}`);
    
    // テーブル一覧を取得
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    console.log('\nテーブル一覧:');
    if (tablesResult.rows.length === 0) {
      console.log('テーブルが見つかりません');
    } else {
      tablesResult.rows.forEach(row => {
        console.log(`- ${row.table_name}`);
      });
    }
    
    // recordsテーブルが存在する場合、構造を確認
    const recordsExist = tablesResult.rows.some(row => row.table_name === 'records');
    if (recordsExist) {
      const columnsResult = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'records'
        ORDER BY ordinal_position
      `);
      
      console.log('\nrecordsテーブルの構造:');
      columnsResult.rows.forEach(col => {
        console.log(`- ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'NULL可' : 'NULL不可'})`);
      });
    }
    
  } catch (err) {
    console.error('接続エラー:', err);
  } finally {
    await client.end();
    console.log('接続を終了しました');
  }
}

testConnection();
