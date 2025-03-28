"use client";

import { useState } from "react";

interface Timestamp {
  time: number;
  text: string;
}

interface TimestampListProps {
  timestamps: Timestamp[];
  onTimestampClick?: (time: number) => void;
}

export default function TimestampList({ timestamps, onTimestampClick }: TimestampListProps) {
  const [expanded, setExpanded] = useState(false);
  
  // タイムスタンプが空の場合
  if (!timestamps || timestamps.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic">
        タイムスタンプはありません
      </div>
    );
  }

  // 表示するタイムスタンプの数を制限（展開時は全て表示）
  const displayedTimestamps = expanded ? timestamps : timestamps.slice(0, 5);
  
  // 時間を「00:00:00」形式に変換する関数
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

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {displayedTimestamps.map((timestamp, index) => (
          <li key={index} className="flex items-center">
            <button
              onClick={() => onTimestampClick && onTimestampClick(timestamp.time)}
              className="flex items-center hover:bg-slate-100 p-1 rounded w-full"
            >
              <span className="font-mono text-sm text-blue-600 min-w-[70px]">
                {formatTime(timestamp.time)}
              </span>
              <span className="ml-2 text-sm text-slate-700 truncate">
                {timestamp.text}
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
