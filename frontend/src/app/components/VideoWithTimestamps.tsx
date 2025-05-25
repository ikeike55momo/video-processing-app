"use client";

import { useState } from "react";
import VideoPlayer from "./VideoPlayer";
import TimestampList from "./TimestampList";

interface Timestamp {
  time: number;
  text: string;
}

interface VideoWithTimestampsProps {
  videoSrc: string;
  timestamps: Timestamp[];
}

export default function VideoWithTimestamps({ videoSrc, timestamps }: VideoWithTimestampsProps) {
  const [currentTime, setCurrentTime] = useState(0);

  // タイムスタンプがクリックされたときの処理
  const handleTimestampClick = (timestamp: string) => {
    const seconds = parseTimestamp(timestamp);
    setCurrentTime(seconds);
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

  // TimestampContext型に変換
  const formattedTimestamps = timestamps.map(ts => {
    // 秒数をHH:MM:SS形式に変換
    const hours = Math.floor(ts.time / 3600);
    const minutes = Math.floor((ts.time % 3600) / 60);
    const seconds = Math.floor(ts.time % 60);
    
    const formattedTime = 
      (hours > 0 ? `${hours.toString().padStart(2, '0')}:` : '') + 
      `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    return {
      timestamp: formattedTime,
      context: ts.text
    };
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <VideoPlayer src={videoSrc} currentTime={currentTime} />
      </div>
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 mb-3">タイムスタンプ</h3>
        <div className="max-h-[400px] overflow-y-auto">
          <TimestampList timestamps={formattedTimestamps} onTimestampClick={handleTimestampClick} />
        </div>
      </div>
    </div>
  );
}
