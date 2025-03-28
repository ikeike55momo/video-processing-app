"use client";

import { useRef, useState, useEffect } from "react";

interface VideoPlayerProps {
  src: string;
  currentTime?: number;
}

export default function VideoPlayer({ src, currentTime = 0 }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTimeState, setCurrentTimeState] = useState(currentTime);

  // 動画の読み込み完了時の処理
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  // 再生時間の更新処理
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTimeState(videoRef.current.currentTime);
      setProgress((videoRef.current.currentTime / duration) * 100);
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
      <video
        ref={videoRef}
        className="w-full"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      >
        <source src={src} type="video/mp4" />
        お使いのブラウザは動画の再生に対応していません。
      </video>

      {/* コントロールパネル */}
      <div className="bg-gray-900 text-white p-2">
        {/* シークバー */}
        <div className="flex items-center mb-2">
          <span className="text-xs mr-2 font-mono">{formatTime(currentTimeState)}</span>
          <input
            type="range"
            min="0"
            max="100"
            value={progress}
            onChange={handleSeek}
            className="flex-grow h-1 bg-gray-700 rounded-full appearance-none cursor-pointer"
          />
          <span className="text-xs ml-2 font-mono">{formatTime(duration)}</span>
        </div>

        {/* 再生コントロール */}
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <button
              onClick={togglePlay}
              className="mr-4 focus:outline-none"
              aria-label={isPlaying ? "一時停止" : "再生"}
            >
              {isPlaying ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          </div>

          {/* 音量コントロール */}
          <div className="flex items-center">
            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
                clipRule="evenodd"
              />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={handleVolumeChange}
              className="w-20 h-1 bg-gray-700 rounded-full appearance-none cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
