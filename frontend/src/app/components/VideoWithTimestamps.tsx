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
  const handleTimestampClick = (time: number) => {
    setCurrentTime(time);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <VideoPlayer src={videoSrc} currentTime={currentTime} />
      </div>
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 mb-3">タイムスタンプ</h3>
        <div className="max-h-[400px] overflow-y-auto">
          <TimestampList timestamps={timestamps} onTimestampClick={handleTimestampClick} />
        </div>
      </div>
    </div>
  );
}
