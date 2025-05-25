import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { testConfig } from './test-config';
import * as dotenv from 'dotenv';

// 環境変数の読み込み
dotenv.config();

/**
 * テスト用のサンプルファイルをダウンロードする
 * 
 * 注意: このスクリプトは実際のURLをハードコードしていません。
 * 実際の使用時には、適切なサンプルファイルのURLを指定してください。
 */
async function downloadTestAssets() {
  console.log('テスト用アセットのダウンロードを開始します...');
  
  // テスト用ディレクトリの作成
  const assetsDir = path.resolve(testConfig.testAssetsDir);
  fs.mkdirSync(assetsDir, { recursive: true });
  
  // サンプルファイルのURLマッピング
  // 実際のテストでは、これらのURLを適切なサンプルファイルのURLに置き換えてください
  const sampleUrls = {
    'short-audio.mp3': 'https://example.com/samples/short-audio.mp3',
    'medium-audio.mp3': 'https://example.com/samples/medium-audio.mp3',
    'short-video.mp4': 'https://example.com/samples/short-video.mp4',
    'medium-video.mp4': 'https://example.com/samples/medium-video.mp4'
  };
  
  // サンプルファイルの作成（実際のダウンロードの代わりに空ファイルを作成）
  console.log('テスト用のサンプルファイルを作成します...');
  
  for (const [filename, url] of Object.entries(sampleUrls)) {
    const filePath = path.join(assetsDir, filename);
    
    // ファイルが既に存在するかチェック
    if (fs.existsSync(filePath)) {
      console.log(`ファイルは既に存在します: ${filename}`);
      continue;
    }
    
    try {
      // 実際のダウンロード処理
      // 注意: 以下はコメントアウトされています。実際のテストでは適切なURLを設定して有効化してください
      /*
      console.log(`ダウンロード中: ${url}`);
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream'
      });
      
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      */
      
      // 代わりに空のテストファイルを作成
      console.log(`テスト用の空ファイルを作成: ${filename}`);
      fs.writeFileSync(filePath, '');
      
      console.log(`ファイルを作成しました: ${filename}`);
    } catch (error) {
      console.error(`ファイルのダウンロード中にエラーが発生しました: ${filename}`, error);
    }
  }
  
  // テストファイルの一覧を表示
  const files = fs.readdirSync(assetsDir);
  console.log('ダウンロードしたテストファイル:');
  console.table(files.map(file => ({
    filename: file,
    size: fs.statSync(path.join(assetsDir, file)).size + ' bytes',
    path: path.join(assetsDir, file)
  })));
  
  console.log('テスト用アセットのセットアップが完了しました');
}

// スクリプトが直接実行された場合のみ実行
if (require.main === module) {
  downloadTestAssets()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { downloadTestAssets };
