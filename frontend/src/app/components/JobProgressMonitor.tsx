/**
 * ジョブの進捗状況をリアルタイムで表示するコンポーネント
 * WebSocketとポーリングフォールバックを使用して進捗状況を監視します
 */
'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { CircularProgress, Box, Typography, Alert, Paper } from '@mui/material';
import { useRouter } from 'next/navigation';

// 進捗状況のデータ型 (BullMQ Job データを含む)
interface JobProgressData {
  recordId?: string;
  status?: string; // DB status from job data
  processing_step?: string;
  processing_progress?: number | null;
  error?: string;
}

// コンポーネント内で使用する進捗状態の型
interface ProgressState {
  progress: number; // Calculated percentage (0-100)
  status: string; // BullMQ state or DB status (e.g., 'active', 'completed', 'DONE', 'ERROR')
  message?: string; // Optional message from worker
  timestamp: number;
  data?: JobProgressData; // Raw data from BullMQ job
  dbStatus?: string; // DB status from polling /api/records or job data
  dbError?: string; // DB error from polling /api/records or job data
  dbProgress?: number | null; // DB progress from polling /api/records or job data
}


// コンポーネントのプロパティ
interface JobProgressMonitorProps {
  jobId: string; // Can be BullMQ jobId or recordId initially
  recordIdProp: string; // Always pass the recordId for redirection
  onComplete?: (result: any) => void;
  onError?: (error: any) => void;
}

// API URLの設定
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
// WebSocketのURLを設定（wss://プロトコルを使用）
const SOCKET_URL = API_URL ? `wss://${API_URL.replace(/^https?:\/\//, '')}` : 'wss://video-processing-api.onrender.com';
console.log('WebSocket URL:', SOCKET_URL);

const JobProgressMonitor: React.FC<JobProgressMonitorProps> = ({
  jobId: initialJobId,
  recordIdProp,
  onComplete,
  onError
}) => {
  const router = useRouter();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [isPollingFallback, setIsPollingFallback] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string>(initialJobId);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // --- Helper Functions ---
  const getProgressValue = useCallback((status: string | undefined, dbProgress: number | null | undefined): number => {
    if (typeof dbProgress === 'number' && dbProgress >= 0 && dbProgress <= 100) {
      return dbProgress;
    }
    switch (status) {
      case 'UPLOADED': return 0;
      case 'PROCESSING': return 25;
      case 'TRANSCRIBED': return 50;
      case 'SUMMARIZED': return 75;
      case 'DONE': case 'completed': return 100;
      case 'ERROR': case 'failed': return progress?.progress ?? 0; // Keep last progress on error if possible
      default: return 0;
    }
  }, [progress?.progress]); // Add progress dependency

  const getStatusText = useCallback((status: string | undefined): string => {
     switch (status) {
      case 'waiting': return '待機中';
      case 'active': return '処理中';
      case 'completed': return '完了';
      case 'failed': return '失敗';
      case 'delayed': return '遅延';
      case 'paused': return '一時停止';
      case 'UPLOADED': return 'アップロード完了';
      case 'PROCESSING': return '処理中';
      case 'TRANSCRIBED': return '文字起こし完了';
      case 'SUMMARIZED': return '要約完了';
      case 'DONE': return '完了';
      case 'ERROR': return 'エラー';
      default: return status || '不明';
    }
  }, []);

  // --- Completion and Failure Handlers ---
  const handleCompletion = useCallback((completionData: any) => {
    if (!isMountedRef.current || completed) return;
    console.log('Job completed. Data:', completionData);
    setCompleted(true); // Set completed flag first
    setProgress(prev => ({
        ...(prev || { progress: 0, status: '', timestamp: 0 }),
        progress: 100,
        status: 'DONE',
        timestamp: Date.now(),
        data: completionData
    }));
    onComplete?.(completionData || {});
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    socket?.disconnect();
  }, [completed, onComplete, socket]);

  // 進捗ステートを更新する共通関数
  const updateProgressState = useCallback((data: Partial<ProgressState>) => {
    if (!isMountedRef.current) return;
    setProgress(prev => {
        const newState = { ...(prev || { progress: 0, status: 'waiting', timestamp: 0 }), ...data, timestamp: Date.now() } as ProgressState;
        // Recalculate progress based on the most definitive status and dbProgress
        newState.progress = getProgressValue(newState.dbStatus || newState.status, newState.dbProgress);
        return newState;
    });
  }, [getProgressValue]);

  const handleFailure = useCallback((errorMessage: string) => {
    if (!isMountedRef.current || completed || error) return;
    console.error('Job failed:', errorMessage);
    setError(`処理が失敗しました: ${errorMessage}`);
    setProgress(prev => ({
        ...(prev || { progress: 0, status: '', timestamp: 0 }),
        status: 'ERROR',
        progress: getProgressValue('ERROR', prev?.dbProgress),
        timestamp: Date.now(),
        dbError: String(errorMessage)
    }));
    onError?.(errorMessage);
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    socket?.disconnect();
  }, [completed, error, onError, socket, getProgressValue]);

  // --- Initialization and Connection Logic ---
  useEffect(() => {
    isMountedRef.current = true;
    let socketIoInstance: Socket | null = null;



    const connectWebSocket = () => {
      if (completed || socket?.connected || !isMountedRef.current) return;

      console.log('Initializing WebSocket connection...');
      socketIoInstance = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        path: '/socket.io',
        reconnectionAttempts: 3,
        reconnectionDelay: 2000,
        timeout: 10000
      });

      socketIoInstance.on('connect', () => {
        if (!isMountedRef.current) return;
        console.log('WebSocket接続確立');
        setIsPollingFallback(false);
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
        socketIoInstance?.emit('joinJobRoom', currentJobId);
      });

      socketIoInstance.on('jobProgress', (data: { jobId: string; progress: ProgressState | number }) => {
        if (!isMountedRef.current || data.jobId !== currentJobId || completed) return;

        let progressUpdate: Partial<ProgressState> = {};
        let statusToCheck: string | undefined;

        if (typeof data.progress === 'number') {
          progressUpdate.progress = data.progress; // Use direct progress if number
          statusToCheck = progress?.status; // Keep previous status
        } else {
          const jobData = data.progress.data;
          statusToCheck = jobData?.status || data.progress.status; // Prioritize DB status from data
          const dbProgress = jobData?.processing_progress;
          progressUpdate = {
              status: statusToCheck,
              message: data.progress.message,
              data: jobData,
              dbStatus: jobData?.status,
              dbError: jobData?.error,
              dbProgress: dbProgress,
              progress: getProgressValue(statusToCheck, dbProgress) // Calculate progress based on status/dbProgress
          };
        }

        console.log('進捗更新 (WebSocket):', progressUpdate);
        updateProgressState(progressUpdate); // Use centralized update function

        // Check completion/failure only based on status
        if (statusToCheck === 'DONE' || statusToCheck === 'completed') {
           handleCompletion(progressUpdate.data || {});
        } else if (statusToCheck === 'ERROR' || statusToCheck === 'failed') {
           handleFailure(progressUpdate.dbError || progressUpdate.message || '不明なエラー');
        }
      });

      socketIoInstance.on('jobCompleted', (data: { jobId: string; result?: any; data?: any }) => {
        if (!isMountedRef.current || data.jobId !== currentJobId || completed) return;
        handleCompletion(data.data || data.result || {});
      });

      socketIoInstance.on('jobFailed', (data: { jobId: string; error: any }) => {
         if (!isMountedRef.current || data.jobId !== currentJobId || completed || error) return;
         handleFailure(data.error || '不明なエラー');
      });

      socketIoInstance.on('disconnect', (reason) => {
        console.log('WebSocket切断:', reason);
        if (isMountedRef.current && !completed && reason !== 'io client disconnect') {
          setIsPollingFallback(true);
        }
      });

      socketIoInstance.on('connect_error', (err) => {
        console.error('WebSocket接続エラー:', err);
        if (isMountedRef.current && !completed) {
          setIsPollingFallback(true);
        }
      });

      setSocket(socketIoInstance);
    };

     const initialize = async () => {
        if (!initialJobId || initialJobId === 'undefined') {
            if(isMountedRef.current) setError('無効なジョブIDです。');
            return;
        }
        try {
            console.log(`Fetching initial status: ${API_URL}/api/job-status/${initialJobId}`);
            const response = await fetch(`${API_URL}/api/job-status/${initialJobId}`);

            if (!isMountedRef.current) return;

            if (response.ok) {
                const data = await response.json();
                console.log('Initial status fetched (job):', data);
                const dbStatus = data.data?.status;
                const dbProgress = data.data?.processing_progress;
                const currentProgress = getProgressValue(dbStatus || data.state, dbProgress);
                setCurrentJobId(data.jobId || initialJobId);

                updateProgressState({ // Use centralized update function
                    progress: currentProgress,
                    status: dbStatus || data.state || 'waiting',
                    data: data.data,
                    dbStatus: dbStatus,
                    dbError: data.data?.error,
                    dbProgress: dbProgress
                });

                if (dbStatus === 'DONE' || data.state === 'completed') {
                    handleCompletion(data.data || {});
                } else if (dbStatus === 'ERROR' || data.state === 'failed') {
                    handleFailure(data.data?.error || data.failedReason || '不明なエラー');
                } else {
                    connectWebSocket();
                }

            } else if (response.status === 404) {
                console.warn(`Job ID ${initialJobId} not found, trying record ID ${recordIdProp}`);
                const recordResponse = await fetch(`${API_URL}/api/records/${recordIdProp}`);

                if (!isMountedRef.current) return;

                if (recordResponse.ok) {
                    const recordData = await recordResponse.json();
                    console.log('Initial status fetched (record):', recordData);
                    const currentProgress = getProgressValue(recordData.status, recordData.processing_progress);
                    setCurrentJobId(recordIdProp);

                    updateProgressState({ // Use centralized update function
                        progress: currentProgress,
                        status: recordData.status,
                        dbStatus: recordData.status,
                        dbError: recordData.error,
                        dbProgress: recordData.processing_progress
                    });

                    if (recordData.status === 'DONE') {
                        handleCompletion(recordData);
                    } else if (recordData.status === 'ERROR') {
                        handleFailure(recordData.error || '不明なエラー');
                    } else {
                        connectWebSocket();
                    }
                } else {
                     console.error(`Failed to fetch initial status for job/record ID: ${initialJobId}`);
                     if(isMountedRef.current) setError('ジョブまたはレコードの状態を取得できませんでした。');
                     setIsPollingFallback(true);
                }
            } else {
                 throw new Error(`ジョブ状態の取得に失敗しました: ${response.statusText}`);
            }
        } catch (err) {
            console.error('初期状態の取得エラー:', err);
            if(isMountedRef.current) setError('状態取得中にエラーが発生しました。');
            setIsPollingFallback(true);
        }
    };

    initialize();

    // Cleanup function
    return () => {
      isMountedRef.current = false;
      if (socketIoInstance) {
        console.log('WebSocket接続をクリーンアップ (unmount)');
        socketIoInstance.emit('leaveJobRoom', currentJobId);
        socketIoInstance.disconnect();
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [initialJobId, recordIdProp, onComplete, onError, API_URL, completed, currentJobId, handleCompletion, handleFailure, getProgressValue]);


  // --- Polling Fallback ---
  useEffect(() => {
    if (!isPollingFallback || completed || socket?.connected) {
         if (pollingIntervalRef.current) {
             console.log("Stopping polling fallback.");
             clearInterval(pollingIntervalRef.current);
             pollingIntervalRef.current = null;
         }
         return;
    };

    if (!pollingIntervalRef.current) {
        console.log("Starting polling fallback...");
        pollingIntervalRef.current = setInterval(async () => {
            if (!isMountedRef.current || completed) {
               if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
               return;
            }
            try {
                const response = await fetch(`${API_URL}/api/records/${recordIdProp}`);
                if (!isMountedRef.current) return;

                if (!response.ok) {
                   console.error(`Polling: Failed to fetch record status ${recordIdProp}: ${response.statusText}`);
                   return;
                }
                const data = await response.json();
                const currentProgress = getProgressValue(data.status, data.processing_progress);
                console.log('ポーリング結果:', data.status, currentProgress);

                updateProgressState({ // Use centralized update function
                  progress: currentProgress,
                  status: data.status,
                  dbStatus: data.status,
                  dbError: data.error,
                  dbProgress: data.processing_progress
                });

                if (data.status === 'DONE') {
                   handleCompletion(data);
                } else if (data.status === 'ERROR') {
                   handleFailure(data.error || '不明なエラー');
                }
            } catch (err) {
                console.error('ポーリング中のエラー:', err);
            }
        }, 3000);
    }

    return () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    };
  }, [isPollingFallback, completed, socket?.connected, recordIdProp, API_URL, handleCompletion, handleFailure, getProgressValue]);


  // --- Redirect Effect ---
  useEffect(() => {
    if (completed) {
      console.log(`[REDIRECT] Completion detected. Redirecting to /results/${recordIdProp}`);
      try {
        // 完了状態を表示するための短い遅延
        const timer = setTimeout(() => {
          if (isMountedRef.current) {
            console.log(`[REDIRECT] Executing redirect to /results/${recordIdProp}`);
            // 強制的なリダイレクト - 問題のトラブルシューティング用
            window.location.href = `/results/${recordIdProp}`;
          }
        }, 1500); // 遅延を増加
        return () => clearTimeout(timer);
      } catch (error) {
        console.error('[REDIRECT] Error during redirect:', error);
      }
    }
  }, [completed, recordIdProp, router]);


  // --- Render Logic ---
  const renderProgress = () => {
    // Use the unified 'progress' state for display
    const displayStatus = progress?.status || 'waiting';
    const displayProgress = progress?.progress ?? 0;
    const displayMessage = progress?.message;
    const displayError = error || progress?.dbError; // Show component error state first

    if (displayError) {
      return (
        <Alert severity="error" sx={{ mb: 2, width: '100%' }}>
          {`エラー: ${displayError}`}
        </Alert>
      );
    }

    if (completed || displayStatus === 'DONE' || displayStatus === 'completed') {
       return (
         <Alert severity="success" sx={{ mb: 2, width: '100%' }}>
           処理が完了しました。結果ページに移動します...
         </Alert>
       );
    }

    if (!progress && !error) {
       return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2 }}>
                <CircularProgress size={60} />
                <Typography variant="body2" color="text.secondary" sx={{mt: 2}}>
                    処理状況を確認中...
                </Typography>
            </Box>
       );
    }

    return (
      <Box sx={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
        <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
          <CircularProgress variant="determinate" value={displayProgress} size={60} />
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
              {`${Math.round(displayProgress)}%`}
            </Typography>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {getStatusText(displayStatus)}
        </Typography>
        {displayMessage && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            {displayMessage}
          </Typography>
        )}
      </Box>
    );
  };


  return (
    <Paper elevation={2} sx={{ p: 2, mb: 2, mt: 2 }}>
      <Typography variant="h6" gutterBottom sx={{ textAlign: 'center' }}>
        処理状況
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2 }}>
         {renderProgress()}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
        ジョブID: {currentJobId}
      </Typography>
    </Paper>
  );
};

export default JobProgressMonitor;
