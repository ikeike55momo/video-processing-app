"use client";

import { useState } from "react";

interface TimestampContext {
  timestamp: string;
  context: string;
}

interface TimestampListProps {
  timestamps: TimestampContext[];
  onTimestampClick?: (timestamp: string) => void;
  videoUrl?: string;
}

export default function TimestampList({ timestamps, onTimestampClick, videoUrl }: TimestampListProps) {
  const [expanded, setExpanded] = useState(false);
  
  // タイムスタンプが空または配列でない場合
  if (!timestamps || !Array.isArray(timestamps) || timestamps.length === 0) {
    console.log('タイムスタンプデータが無効です:', timestamps);
    return (
      <div className="text-sm text-slate-500 italic">
        タイムスタンプはありません
      </div>
    );
  }

  // 表示するタイムスタンプの数を制限（展開時は全て表示）
  const displayedTimestamps = expanded ? timestamps : timestamps.slice(0, 5);
  
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
    if (onTimestampClick) {
      onTimestampClick(timestamp);
    } else if (videoUrl) {
      // 動画プレーヤーがある場合、タイムスタンプに移動
      const videoElement = document.querySelector('video');
      if (videoElement) {
        const seconds = parseTimestamp(timestamp);
        videoElement.currentTime = seconds;
        videoElement.play().catch(e => console.error('再生開始エラー:', e));
      }
    }
  };

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {displayedTimestamps.map((item, index) => (
          <li key={index} className="flex items-start border-b border-slate-100 pb-2 last:border-0">
            <button
              onClick={() => handleTimestampClick(item.timestamp)}
              className="flex items-start hover:bg-slate-100 p-1 rounded w-full"
            >
              <span className="font-mono text-sm text-blue-600 min-w-[70px] mt-1">
                {item.timestamp}
              </span>
              <span className="ml-2 text-sm text-slate-700">
                {item.context}
              </span>
            </button>
          </li>
        ))}
      </ul>
      
      {timestamps.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          {expanded ? "折りたたむ" : `他${timestamps.length - 5}件を表示`}
        </button>
      )}
    </div>
  );
}
