declare module 'fluent-ffmpeg' {
  namespace ffmpeg {
    interface FfmpegCommand {
      input(input: string): FfmpegCommand;
      noVideo(): FfmpegCommand;
      audioCodec(codec: string): FfmpegCommand;
      audioBitrate(bitrate: string): FfmpegCommand;
      audioChannels(channels: number): FfmpegCommand;
      audioFrequency(frequency: number): FfmpegCommand;
      output(output: string): FfmpegCommand;
      on(event: 'start', callback: (commandLine: string) => void): FfmpegCommand;
      on(event: 'progress', callback: (progress: any) => void): FfmpegCommand;
      on(event: 'error', callback: (err: Error, stdout: string, stderr: string) => void): FfmpegCommand;
      on(event: 'end', callback: () => void): FfmpegCommand;
      run(): void;
    }
  }

  function ffmpeg(options?: any): ffmpeg.FfmpegCommand;
  
  // 静的メソッド
  namespace ffmpeg {
    function setFfmpegPath(path: string): void;
    function ffprobe(filePath: string, callback: (err: Error, metadata: any) => void): void;
  }
  
  export = ffmpeg;
}
