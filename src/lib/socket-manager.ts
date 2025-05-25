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
        origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
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
   * 新しい初期化メソッド（server.tsとの互換性のため）
   * @param server HTTPサーバー
   */
  init(server: HttpServer) {
    return this.initialize(server);
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
   * 特定のレコードに関連するイベントを発行する
   * @param recordId レコードID
   * @param event イベント名
   * @param data イベントデータ
   */
  emitToRecord(recordId: string, event: string, data: any) {
    if (!this.io) {
      console.warn('Socket.IO server is not initialized');
      return;
    }

    const roomName = `record-${recordId}`;
    this.io.to(roomName).emit(event, data);
    console.log(`Emitted ${event} to ${roomName}`, data);
  }

  /**
   * 特定のジョブに関連するイベントを発行する
   * @param jobId ジョブID
   * @param event イベント名
   * @param data イベントデータ
   */
  emitToJob(jobId: string, event: string, data: any) {
    if (!this.io) {
      console.warn('Socket.IO server is not initialized');
      return;
    }

    const roomName = `job-${jobId}`;
    this.io.to(roomName).emit(event, data);
    console.log(`Emitted ${event} to ${roomName}`, data);
  }

  /**
   * 全クライアントにイベントを発行する
   * @param event イベント名
   * @param data イベントデータ
   */
  emitToAll(event: string, data: any) {
    if (!this.io) {
      console.warn('Socket.IO server is not initialized');
      return;
    }

    this.io.emit(event, data);
    console.log(`Emitted ${event} to all clients`, data);
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
