import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { jobEvents } from './bull-queue';

// ソケットマネージャークラス
export class SocketManager {
  private io: SocketIOServer | null = null;

  /**
   * ソケットサーバーを初期化する
   * @param server HTTPサーバー
   */
  initialize(server: HttpServer) {
    if (this.io) {
      console.log('Socket.IO server is already initialized');
      return this.io;
    }

    this.io = new SocketIOServer(server, {
      cors: {
        origin: '*', // 開発中は全てのオリジンを許可
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      path: '/socket.io',
      connectTimeout: 45000, // 接続タイムアウトを45秒に設定
      pingTimeout: 30000, // pingタイムアウトを30秒に設定
      pingInterval: 25000 // ping間隔を25秒に設定
    });

    console.log('Socket.IO server initialized with options:', {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      path: '/socket.io'
    });

    console.log('Socket.IO server initialized');

    // クライアント接続イベントを処理
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);

      // 特定のジョブの進捗状況を監視するルーム
      socket.on('joinJobRoom', (jobId) => {
        socket.join(`job-${jobId}`);
        console.log(`Client ${socket.id} joined room for job ${jobId}`);
      });

      // ルームから退出
      socket.on('leaveJobRoom', (jobId) => {
        socket.leave(`job-${jobId}`);
        console.log(`Client ${socket.id} left room for job ${jobId}`);
      });

      // 切断イベント
      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });

    // ジョブイベントリスナーを設定
    this.setupJobEventListeners();

    return this.io;
  }

  /**
   * ジョブイベントリスナーを設定する
   */
  private setupJobEventListeners() {
    if (!this.io) {
      console.error('Cannot setup job event listeners: Socket.IO server not initialized');
      return;
    }

    // 進捗イベント
    jobEvents.on('job:progress', ({ jobId, progress }) => {
      this.io?.to(`job-${jobId}`).emit('jobProgress', { jobId, progress });
    });

    // 完了イベント
    jobEvents.on('job:completed', ({ jobId, result }) => {
      this.io?.to(`job-${jobId}`).emit('jobCompleted', { jobId, result });
    });

    // 失敗イベント
    jobEvents.on('job:failed', ({ jobId, error }) => {
      this.io?.to(`job-${jobId}`).emit('jobFailed', { jobId, error });
    });
  }

  /**
   * ジョブの進捗を通知する
   * @param jobId ジョブID
   * @param progress 進捗データ
   */
  notifyJobProgress(jobId: string, progress: any) {
    if (!this.io) {
      console.error('Cannot notify job progress: Socket.IO server not initialized');
      return;
    }

    this.io.to(`job-${jobId}`).emit('jobProgress', { jobId, progress });
  }

  /**
   * ジョブの完了を通知する
   * @param jobId ジョブID
   * @param result 結果
   */
  notifyJobCompleted(jobId: string, result: any) {
    if (!this.io) {
      console.error('Cannot notify job completion: Socket.IO server not initialized');
      return;
    }

    this.io.to(`job-${jobId}`).emit('jobCompleted', { jobId, result });
  }

  /**
   * ジョブの失敗を通知する
   * @param jobId ジョブID
   * @param error エラー
   */
  notifyJobFailed(jobId: string, error: any) {
    if (!this.io) {
      console.error('Cannot notify job failure: Socket.IO server not initialized');
      return;
    }

    this.io.to(`job-${jobId}`).emit('jobFailed', { jobId, error });
  }

  /**
   * ソケットサーバーを取得する
   */
  getIO(): SocketIOServer | null {
    return this.io;
  }
}

// シングルトンインスタンス
export const socketManager = new SocketManager();
