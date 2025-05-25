"use client";

import { useRef, useState, useEffect } from "react";

interface VideoPlayerProps {
  src: string;
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
  timestamps?: { timestamp: string; context: string }[];
}

export default function VideoPlayer({ 
  src, 
  currentTime = 0, 
  onTimeUpdate,
  timestamps = []
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTimeState, setCurrentTimeState] = useState(currentTime);
  const [showTimestamps, setShowTimestamps] = useState(false);

  // 動画の読み込み完了時の処理
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  // 再生時間の更新処理
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const newTime = videoRef.current.currentTime;
      setCurrentTimeState(newTime);
      setProgress((newTime / duration) * 100);
      
      // 親コンポーネントに現在時間を通知
      if (onTimeUpdate) {
        onTimeUpdate(newTime);
      }
    }
  };

  // 再生/一時停止の切り替え
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // 音量調整
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
    }
  };

  // シークバーの操作
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const seekTime = (parseFloat(e.target.value) / 100) * duration;
    setProgress(parseFloat(e.target.value));
    if (videoRef.current) {
      videoRef.current.currentTime = seekTime;
    }
  };

  // 時間のフォーマット（秒→「00:00:00」形式）
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      secs.toString().padStart(2, '0')
    ].join(':');
  };

  // タイムスタンプ文字列を秒数に変換する関数
  const parseTimestamp = (timestamp: string): number => {
    // HH:MM:SS 形式または MM:SS 形式のタイムスタンプを解析
    const parts = timestamp.split(':').map(Number);
    
    if (parts.length === 3) {
      // HH:MM:SS 形式
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      // MM:SS 形式
      return parts[0] * 60 + parts[1];
    }
    
    return 0;
  };

  // タイムスタンプをクリックした時の処理
  const handleTimestampClick = (timestamp: string) => {
    if (videoRef.current) {
      const seconds = parseTimestamp(timestamp);
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(e => console.error('再生開始エラー:', e));
      setIsPlaying(true);
    }
  };

  // 外部からcurrentTimeが変更された場合の処理
  useEffect(() => {
    if (videoRef.current && currentTime !== currentTimeState) {
      videoRef.current.currentTime = currentTime;
      setCurrentTimeState(currentTime);
      
      // 自動再生（タイムスタンプクリック時）
      if (!isPlaying) {
        videoRef.current.play()
          .then(() => setIsPlaying(true))
          .catch(error => console.error("自動再生できませんでした:", error));
      }
    }
  }, [currentTime]);

  return (
    <div className="w-full rounded-lg overflow-hidden shadow-lg bg-black">
      {/* 動画プレーヤー */}
      <div className="relative">
        <video
          ref={videoRef}
          className="w-full"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          controls={false}
          src={src}
        />
        
        {/* カスタムコントロール */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          {/* シークバー */}
          <div className="flex items-center mb-2">
            <input
              type="range"
              min="0"
              max="100"
              value={progress}
              onChange={handleSeek}
              className="w-full h-1 bg-gray-400 rounded-lg appearance-none cursor-pointer"
            />
          </div>
          
          {/* コントロールボタン */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {/* 再生/一時停止ボタン */}
              <button onClick={togglePlay} className="text-white">
                {isPlaying ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 008 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </button>
              
              {/* 音量コントロール */}
              <div className="flex items-center space-x-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="w-16 h-1 bg-gray-400 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
            
            {/* 時間表示 */}
            <div className="text-white text-sm">
              {formatTime(currentTimeState)} / {formatTime(duration)}
            </div>
            
            {/* タイムスタンプ表示トグル */}
            {timestamps && timestamps.length > 0 && (
              <button 
                onClick={() => setShowTimestamps(!showTimestamps)} 
                className="text-white ml-2"
                title="タイムスタンプを表示/非表示"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* タイムスタンプ一覧（表示/非表示切り替え可能） */}
      {showTimestamps && timestamps && timestamps.length > 0 && (
        <div className="bg-slate-100 p-3 max-h-40 overflow-y-auto">
          <h3 className="text-sm font-medium text-slate-700 mb-2">タイムスタンプ</h3>
          <ul className="space-y-1">
            {timestamps.map((item, index) => (
              <li key={index} className="flex items-start border-b border-slate-200 pb-1 last:border-0">
                <button
                  onClick={() => handleTimestampClick(item.timestamp)}
                  className="flex items-start hover:bg-slate-200 p-1 rounded w-full"
                >
                  <span className="font-mono text-xs text-blue-600 min-w-[70px] mt-1">
                    {item.timestamp}
                  </span>
                  <span className="ml-2 text-xs text-slate-700">
                    {item.context}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
