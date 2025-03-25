/**
 * テスト環境セットアップスクリプト
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

// テスト用ディレクトリ
const TEST_ASSETS_DIR = path.join(__dirname, '../../test-assets');
const TEST_RESULTS_DIR = path.join(__dirname, '../../test-results');

// テスト用レコード
const TEST_RECORDS = [
  {
    id: 'test-short-audio',
    file_key: 'test-assets/short-audio.mp3',
    status: 'UPLOADED'
  },
  {
    id: 'test-medium-audio',
    file_key: 'test-assets/medium-audio.mp3',
    status: 'UPLOADED'
  },
  {
    id: 'test-short-video',
    file_key: 'test-assets/short-video.mp4',
    status: 'UPLOADED'
  },
  {
    id: 'test-medium-video',
    file_key: 'test-assets/medium-video.mp4',
    status: 'UPLOADED'
  }
];

/**
 * テスト用ディレクトリの作成
 */
function setupTestDirectories() {
  console.log('テスト用ディレクトリを作成します...');
  
  // テスト用アセットディレクトリの作成
  fs.mkdirSync(TEST_ASSETS_DIR, { recursive: true });
  console.log(`テスト用アセットディレクトリを作成しました: ${TEST_ASSETS_DIR}`);
  
  // テスト結果ディレクトリの作成
  fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
  console.log(`テスト結果ディレクトリを作成しました: ${TEST_RESULTS_DIR}`);
  
  // テスト用サンプルファイルの作成
  const sampleFiles = [
    'short-audio.mp3',
    'medium-audio.mp3',
    'short-video.mp4',
    'medium-video.mp4'
  ];
  
  for (const file of sampleFiles) {
    const filePath = path.join(TEST_ASSETS_DIR, file);
    if (!fs.existsSync(filePath)) {
      // 空のファイルを作成
      fs.writeFileSync(filePath, '');
      console.log(`テスト用サンプルファイルを作成しました: ${filePath}`);
    } else {
      console.log(`テスト用サンプルファイルは既に存在します: ${filePath}`);
    }
  }
  
  // テスト用ファイルの一覧を表示
  const files = fs.readdirSync(TEST_ASSETS_DIR);
  console.log('テスト用ファイル一覧:');
  for (const file of files) {
    const stats = fs.statSync(path.join(TEST_ASSETS_DIR, file));
    console.log(`- ${file} (${stats.size} bytes)`);
  }
}

/**
 * テスト用データベースのセットアップ
 */
async function setupTestDatabase() {
  console.log('\nテスト用データベースをセットアップします...');
  
  const prisma = new PrismaClient();
  
  try {
    // テスト用レコードの作成
    for (const testRecord of TEST_RECORDS) {
      // 既存のレコードを確認
      const existingRecord = await prisma.record.findUnique({
        where: { 
          id: testRecord.id 
        }
      });
      
      if (existingRecord) {
        console.log(`既存のテストレコードを更新します: ${testRecord.id}`);
        await prisma.record.update({
          where: { id: testRecord.id },
          data: {
            file_key: testRecord.file_key,
            status: testRecord.status,
            transcription: null,
            summary: null,
            article: null,
            errorMessage: null,
            processing_step: null
          }
        });
      } else {
        console.log(`新しいテストレコードを作成します: ${testRecord.id}`);
        await prisma.record.create({
          data: {
            id: testRecord.id,
            fileUrl: `https://example.com/${testRecord.file_key}`,
            file_key: testRecord.file_key,
            status: testRecord.status
          }
        });
      }
    }
    
    // 作成したレコードの確認
    const records = await prisma.record.findMany({
      where: {
        id: {
          in: TEST_RECORDS.map(r => r.id)
        }
      }
    });
    
    console.log('テスト用レコード一覧:');
    for (const record of records) {
      console.log(`- ID: ${record.id}, ファイル: ${record.file_key}, ステータス: ${record.status}`);
    }
    
    console.log('テスト用データベースのセットアップが完了しました');
  } catch (error) {
    console.error('テスト用データベースのセットアップ中にエラーが発生しました:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * メイン関数
 */
async function main() {
  console.log('=== テスト環境のセットアップを開始します ===');
  
  // テスト用ディレクトリのセットアップ
  setupTestDirectories();
  
  // テスト用データベースのセットアップ
  await setupTestDatabase();
  
  console.log('\n=== テスト環境のセットアップが完了しました ===');
}

// スクリプトの実行
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  });
