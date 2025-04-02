import React, { useRef, useState, useEffect } from 'react';

interface VideoWithTimestampsProps {
  src: string | null;
  timestamps: { time: number; text: string }[];
}

const VideoWithTimestamps: React.FC<VideoWithTimestampsProps> = ({ src, timestamps }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // 動画の現在時間を更新
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  // タイムスタンプをクリックして動画をシーク
  const seekToTime = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play().catch(err => console.error('再生エラー:', err));
    }
  };

  // 現在のタイムスタンプを強調表示
  const getCurrentTimestamp = () => {
    if (!timestamps || timestamps.length === 0) return null;
    
    // 現在の時間以下の最大のタイムスタンプを探す
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i].time <= currentTime) {
        return timestamps[i];
      }
    }
    
    return timestamps[0]; // デフォルトは最初のタイムスタンプ
  };

  const currentTimestamp = getCurrentTimestamp();

  return (
    <div className="video-with-timestamps">
      {src ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <video
              ref={videoRef}
              src={src}
              controls
              onTimeUpdate={handleTimeUpdate}
              className="w-full rounded-md"
            />
          </div>
          <div className="md:col-span-1">
            <div className="bg-slate-100 rounded-md p-3 max-h-60 overflow-y-auto">
              <h4 className="font-medium text-slate-700 mb-2">タイムスタンプ</h4>
              {timestamps && timestamps.length > 0 ? (
                <ul className="space-y-1">
                  {timestamps.map((stamp, index) => (
                    <li
                      key={index}
                      className={`cursor-pointer p-1 rounded text-sm ${
                        currentTimestamp && stamp.time === currentTimestamp.time
                          ? 'bg-blue-100 text-blue-800'
                          : 'hover:bg-slate-200'
                      }`}
                      onClick={() => seekToTime(stamp.time)}
                    >
                      <span className="font-mono text-slate-500">
                        {Math.floor(stamp.time / 60)}:{(stamp.time % 60).toString().padStart(2, '0')}
                      </span>{' '}
                      {stamp.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500 italic">タイムスタンプはありません</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-100 rounded-md p-4 text-center text-slate-500">
          動画ファイルが利用できません
        </div>
      )}
    </div>
  );
};

export default VideoWithTimestamps;
