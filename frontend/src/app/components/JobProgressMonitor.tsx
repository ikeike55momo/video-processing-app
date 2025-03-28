/**
 * ジョブの進捗状況をリアルタイムで表示するコンポーネント
 * WebSocketを使用して進捗状況を監視します
 */
'use client';

import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { CircularProgress, Box, Typography, Alert, Paper } from '@mui/material';

// 進捗状況の型定義
interface JobProgress {
  progress: number;
  status: string;
  message?: string;
  timestamp: number;
}

// コンポーネントのプロパティ
interface JobProgressMonitorProps {
  jobId: string;
  onComplete?: (result: any) => void;
  onError?: (error: any) => void;
}

// API URLの設定
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const SOCKET_URL = API_URL ? API_URL.replace(/^https?:\/\//, '') : 'vpm.ririaru-stg.cloud';

const JobProgressMonitor: React.FC<JobProgressMonitorProps> = ({
  jobId,
  onComplete,
  onError
}) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  // 初期状態を取得
  useEffect(() => {
    const fetchInitialStatus = async () => {
      try {
        const response = await fetch(`${API_URL}/api/job-status/${jobId}`);
        if (!response.ok) {
          throw new Error(`ジョブ状態の取得に失敗しました: ${response.statusText}`);
        }
        
        const data = await response.json();
        setProgress({
          progress: data.progress?.progress || 0,
          status: data.state || 'waiting',
          timestamp: Date.now()
        });
        
        if (data.state === 'completed') {
          setCompleted(true);
          onComplete?.(data.result);
        } else if (data.state === 'failed') {
          setError(`ジョブが失敗しました: ${data.failedReason || '不明なエラー'}`);
          onError?.(data.failedReason);
        }
      } catch (err) {
        console.error('初期状態の取得エラー:', err);
        setError(`初期状態の取得に失敗しました: ${err instanceof Error ? err.message : '不明なエラー'}`);
      }
    };

    fetchInitialStatus();
  }, [jobId, onComplete, onError]);

  // WebSocket接続を確立
  useEffect(() => {
    if (completed) return;

    // Socket.IOクライアントを初期化
    const socketIo = io(SOCKET_URL, {
      transports: ['websocket'],
      path: '/socket.io'
    });

    // 接続イベント
    socketIo.on('connect', () => {
      console.log('WebSocket接続確立');
      // ジョブルームに参加
      socketIo.emit('joinJobRoom', jobId);
    });

    // 進捗イベント
    socketIo.on('jobProgress', (data: { jobId: string; progress: JobProgress }) => {
      if (data.jobId === jobId) {
        console.log('進捗更新:', data.progress);
        setProgress(data.progress);
      }
    });

    // 完了イベント
    socketIo.on('jobCompleted', (data: { jobId: string; result: any }) => {
      if (data.jobId === jobId) {
        console.log('ジョブ完了:', data.result);
        setCompleted(true);
        onComplete?.(data.result);
      }
    });

    // エラーイベント
    socketIo.on('jobFailed', (data: { jobId: string; error: any }) => {
      if (data.jobId === jobId) {
        console.error('ジョブ失敗:', data.error);
        setError(`ジョブが失敗しました: ${data.error || '不明なエラー'}`);
        onError?.(data.error);
      }
    });

    // 切断イベント
    socketIo.on('disconnect', () => {
      console.log('WebSocket切断');
    });

    // エラーイベント
    socketIo.on('error', (err) => {
      console.error('WebSocketエラー:', err);
      setError(`WebSocket接続エラー: ${err}`);
    });

    // ソケットを状態に保存
    setSocket(socketIo);

    // クリーンアップ関数
    return () => {
      console.log('WebSocket接続をクリーンアップ');
      socketIo.emit('leaveJobRoom', jobId);
      socketIo.disconnect();
    };
  }, [jobId, completed, onComplete, onError]);

  // 進捗状況を表示
  const renderProgress = () => {
    if (!progress) {
      return <CircularProgress size={24} />;
    }

    return (
      <Box sx={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
        <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
          <CircularProgress variant="determinate" value={progress.progress} size={60} />
          <Box
            sx={{
              top: 0,
              left: 0,
              bottom: 0,
              right: 0,
              position: 'absolute',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="caption" component="div" color="text.secondary">
              {`${Math.round(progress.progress)}%`}
            </Typography>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {getStatusText(progress.status)}
        </Typography>
        {progress.message && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            {progress.message}
          </Typography>
        )}
      </Box>
    );
  };

  // ステータスを日本語に変換
  const getStatusText = (status: string): string => {
    switch (status) {
      case 'waiting':
        return '待機中';
      case 'active':
        return '処理中';
      case 'completed':
        return '完了';
      case 'failed':
        return '失敗';
      case 'delayed':
        return '遅延';
      case 'paused':
        return '一時停止';
      default:
        return status;
    }
  };

  return (
    <Paper elevation={2} sx={{ p: 2, mb: 2 }}>
      <Typography variant="h6" gutterBottom>
        処理状況
      </Typography>
      
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : completed ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          処理が完了しました
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2 }}>
          {renderProgress()}
        </Box>
      )}
      
      <Typography variant="caption" color="text.secondary">
        ジョブID: {jobId}
      </Typography>
    </Paper>
  );
};

export default JobProgressMonitor;
