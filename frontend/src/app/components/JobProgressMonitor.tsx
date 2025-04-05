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
// WebSocketのURLを設定（wss://プロトコルを使用）
const SOCKET_URL = API_URL ? `wss://${API_URL.replace(/^https?:\/\//, '')}` : 'wss://video-processing-api.onrender.com';
console.log('WebSocket URL:', SOCKET_URL);

const JobProgressMonitor: React.FC<JobProgressMonitorProps> = ({
  jobId,
  onComplete,
  onError
}) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  // 定期的にポーリングするための状態
  const [usePolling, setUsePolling] = useState(false);
  const [recordId, setRecordId] = useState<string | null>(null);

  // 初期状態を取得
  useEffect(() => {
    const fetchInitialStatus = async () => {
      try {
        // jobIdが空または'undefined'の場合は処理しない
        if (!jobId || jobId === 'undefined') {
          console.error('Invalid jobId:', jobId);
          setError('無効なジョブIDです。処理を開始できません。');
          return;
        }

        // まず/api/job-status/:jobIdエンドポイントを試す
        console.log(`ジョブ状態を取得: ${API_URL}/api/job-status/${jobId}`);
        const response = await fetch(`${API_URL}/api/job-status/${jobId}`);
        
        // 404の場合は/api/records/:idエンドポイントを試す
        if (response.status === 404) {
          console.log(`ジョブID ${jobId} が見つかりません。レコードIDとして扱い、/api/records/${jobId}を試みます。`);
          
          try {
            const recordResponse = await fetch(`${API_URL}/api/records/${jobId}`);
            
            if (recordResponse.ok) {
              const recordData = await recordResponse.json();
              setRecordId(jobId); // jobIdはrecordIdとして扱う
              
              // 処理状態に基づいて進捗を設定
              const progressValue = getProgressFromStatus(recordData.status);
              setProgress({
                progress: progressValue,
                status: recordData.status,
                message: `処理状態: ${recordData.status}`,
                timestamp: Date.now()
              });
              
              // 完了または失敗の場合
              if (recordData.status === 'DONE') {
                setCompleted(true);
                onComplete?.(recordData);
              } else if (recordData.status === 'ERROR') {
                setError(`処理が失敗しました: ${recordData.error || '不明なエラー'}`);
                onError?.(recordData.error);
              } else {
                // ポーリングを有効化
                setUsePolling(true);
              }
              
              return;
            }
          } catch (recordErr) {
            console.error('レコード取得エラー:', recordErr);
          }
          
          // レコードも見つからない場合は処理中として扱う
          console.log(`レコードID ${jobId} も見つかりません。処理中として扱います。`);
          setProgress({
            progress: 0,
            status: 'waiting',
            message: '処理の開始を待っています...',
            timestamp: Date.now()
          });
          
          // ポーリングを有効化
          setUsePolling(true);
          return;
        }
        
        if (!response.ok) {
          throw new Error(`ジョブ状態の取得に失敗しました: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('ジョブ状態取得成功:', data);
        
        setProgress({
          progress: data.progress || 0,
          status: data.state || 'waiting',
          timestamp: Date.now()
        });
        
        if (data.state === 'completed') {
          setCompleted(true);
          // data.resultではなくdata.dataを使用する
          onComplete?.(data.data || data);
        } else if (data.state === 'failed') {
          setError(`ジョブが失敗しました: ${data.failedReason || '不明なエラー'}`);
          onError?.(data.failedReason);
        }
      } catch (err) {
        console.error('初期状態の取得エラー:', err);
        // エラーが発生しても処理を継続（WebSocketで状態を取得できる可能性がある）
        setProgress({
          progress: 0,
          status: 'waiting',
          message: '状態取得中にエラーが発生しましたが、処理は継続しています...',
          timestamp: Date.now()
        });
        
        // ポーリングを有効化
        setUsePolling(true);
      }
    };

    fetchInitialStatus();
  }, [jobId, onComplete, onError, API_URL]);
  
  // ステータスから進捗値を取得する関数
  const getProgressFromStatus = (status: string): number => {
    switch (status) {
      case 'UPLOADED':
        return 0;
      case 'PROCESSING':
        return 25;
      case 'TRANSCRIBED':
        return 50;
      case 'SUMMARIZED':
        return 75;
      case 'DONE':
        return 100;
      case 'ERROR':
        return 0;
      default:
        return 0;
    }
  };
  
  // ポーリングによる状態取得
  useEffect(() => {
    if (!usePolling || completed) return;
    
    const pollInterval = setInterval(async () => {
      try {
        // recordIdが設定されている場合は/api/records/:idエンドポイントを使用
        if (recordId) {
          const response = await fetch(`${API_URL}/api/records/${recordId}`);
          
          if (response.ok) {
            const data = await response.json();
            
            // 処理状態に基づいて進捗を設定
            const progressValue = getProgressFromStatus(data.status);
            setProgress({
              progress: progressValue,
              status: data.status,
              message: `処理状態: ${data.status}`,
              timestamp: Date.now()
            });
            
            // 完了または失敗の場合
            if (data.status === 'DONE') {
              setCompleted(true);
              onComplete?.(data);
              clearInterval(pollInterval);
            } else if (data.status === 'ERROR') {
              setError(`処理が失敗しました: ${data.error || '不明なエラー'}`);
              onError?.(data.error);
              clearInterval(pollInterval);
            }
          }
        } else {
          // jobIdを使用して/api/job-status/:jobIdエンドポイントを試す
          const response = await fetch(`${API_URL}/api/job-status/${jobId}`);
          
          if (response.ok) {
            const data = await response.json();
            
            setProgress({
              progress: data.progress || 0,
              status: data.state || 'waiting',
              timestamp: Date.now()
            });
            
            if (data.state === 'completed') {
              setCompleted(true);
              // data.resultではなくdata.dataを使用する
              onComplete?.(data.data || data);
              clearInterval(pollInterval);
            } else if (data.state === 'failed') {
              setError(`ジョブが失敗しました: ${data.failedReason || '不明なエラー'}`);
              onError?.(data.failedReason);
              clearInterval(pollInterval);
            }
          }
        }
      } catch (err) {
        console.error('ポーリング中のエラー:', err);
      }
    }, 2000); // 2秒ごとにポーリング（5秒から短縮）
    
    return () => clearInterval(pollInterval);
  }, [usePolling, completed, recordId, jobId, onComplete, onError, API_URL]);

  // WebSocket接続を確立
  useEffect(() => {
    if (completed) return;

    // Socket.IOクライアントを初期化
    const socketIo = io(SOCKET_URL, {
      transports: ['websocket', 'polling'], // WebSocketとポーリングの両方をサポート
      path: '/socket.io',
      reconnectionAttempts: 5, // 再接続の試行回数
      reconnectionDelay: 1000, // 再接続の遅延（ミリ秒）
      timeout: 20000 // 接続タイムアウト（ミリ秒）
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
    socketIo.on('jobCompleted', (data: { jobId: string; result: any; data?: any }) => {
      if (data.jobId === jobId) {
        console.log('ジョブ完了:', data.result || data.data);
        setCompleted(true);
        // data.resultではなくdata.dataを優先して使用する
        onComplete?.(data.data || data.result || data);
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
