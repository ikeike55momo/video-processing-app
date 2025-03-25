/**
 * テスト環境設定ファイル
 */
export const testConfig = {
  // テスト用ディレクトリ
  testAssetsDir: './test-assets',
  testResultsDir: './test-results',
  
  // テスト用サンプルファイル
  sampleFiles: {
    shortAudio: './test-assets/short-audio.mp3',
    mediumAudio: './test-assets/medium-audio.mp3',
    longAudio: './test-assets/long-audio.mp3',
    shortVideo: './test-assets/short-video.mp4',
    mediumVideo: './test-assets/medium-video.mp4',
    longVideo: './test-assets/long-video.mp4',
  },
  
  // テスト用データベースレコード
  testRecords: [
    {
      id: 'test-short-audio',
      file_key: './test-assets/short-audio.mp3',
      status: 'UPLOADED'
    },
    {
      id: 'test-medium-audio',
      file_key: './test-assets/medium-audio.mp3',
      status: 'UPLOADED'
    },
    {
      id: 'test-short-video',
      file_key: './test-assets/short-video.mp4',
      status: 'UPLOADED'
    },
    {
      id: 'test-medium-video',
      file_key: './test-assets/medium-video.mp4',
      status: 'UPLOADED'
    }
  ]
};
