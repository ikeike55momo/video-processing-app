import { downloadTestAssets } from './download-test-assets';
import { setupTestDatabase } from './setup-test-db';
import { runIntegrationTest } from './integration-test';
import * as dotenv from 'dotenv';

// 環境変数の読み込み
dotenv.config();

/**
 * テスト実行スクリプト
 * すべてのテスト環境セットアップと各種テストを実行します
 */
async function runAllTests() {
  try {
    console.log('=== テスト環境のセットアップを開始します ===');
    
    // テスト用アセットのダウンロード
    console.log('\n--- テスト用アセットのダウンロード ---');
    await downloadTestAssets();
    
    // テスト用データベースのセットアップ
    console.log('\n--- テスト用データベースのセットアップ ---');
    await setupTestDatabase();
    
    // 統合テストの実行
    console.log('\n--- 統合テストの実行 ---');
    await runIntegrationTest();
    
    console.log('\n=== すべてのテストが完了しました ===');
  } catch (error) {
    console.error('テスト実行中にエラーが発生しました:', error);
    process.exit(1);
  }
}

// スクリプトが直接実行された場合のみ実行
if (require.main === module) {
  runAllTests()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { runAllTests };
