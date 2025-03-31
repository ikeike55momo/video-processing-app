/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    domains: ['storage.googleapis.com'],
  },
  // キャッシュを無効化（開発用）
  onDemandEntries: {
    // サーバーサイドのページキャッシュの有効期間（ms）
    maxInactiveAge: 10 * 1000,
    // 同時にメモリにキャッシュするページの最大数
    pagesBufferLength: 1,
  },
  // ビルドキャッシュを完全に無効化
  experimental: {
    disableOptimizedLoading: true,
    optimizeCss: false,
  },
  // Node.jsモジュールのポリフィル設定
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // クライアントサイドのビルド時にNode.js固有のモジュールをポリフィルする
      config.resolve.fallback = {
        fs: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        buffer: false,
        util: false,
        process: false,
      };
    }
    return config;
  },
  // バージョンを強制的に更新するためのランダム値
  generateBuildId: () => {
    return 'build-' + Date.now();
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version' },
        ],
      },
    ]
  },
  // APIリクエストをバックエンドに転送する設定
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://video-processing-api.onrender.com';
    console.log('API URL for rewrites:', apiUrl);
    
    return [
      // Next Authのエンドポイントはリダイレクトしない
      {
        source: '/api/(?!auth/).*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
}

module.exports = nextConfig
