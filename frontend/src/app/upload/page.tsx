"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { uploadMultipart } from "@/lib/storage";
import JobProgressMonitor from "../components/JobProgressMonitor";
import { ProcessingPipeline } from "../services/processing-pipeline";

export default function UploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [uploadStage, setUploadStage] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingError, setProcessingError] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [uploadError, setUploadError] = useState(false);

  // セッションチェック
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">読み込み中...</h2>
          <p>ユーザー情報を確認しています</p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    router.push("/login");
    return null;
  }

  // ファイル選択ハンドラー
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    setError("");

    if (!selectedFile) {
      return;
    }

    // ファイルタイプチェック
    if (selectedFile.type !== "video/mp4") {
      setError("MP4形式の動画ファイルのみアップロード可能です");
      return;
    }

    // ファイルサイズチェック (最大サイズを拡大: 15GB = 15 * 1024 * 1024 * 1024 bytes)
    const maxSize = 15 * 1024 * 1024 * 1024;
    if (selectedFile.size > maxSize) {
      setError("ファイルサイズは15GB以下にしてください");
      return;
    }

    setFile(selectedFile);
  };

  // ファイルアップロード処理
  const handleFileUpload = async (file: File) => {
    try {
      setUploading(true);
      setUploadProgress(0);
      setStatusMessage('ファイルをアップロード中...');
      
      // ファイル名からファイルキーを生成
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 10);
      const fileKey = `${timestamp}-${randomString}-${file.name}`;
      
      console.log('ファイルアップロード開始:', file.name);
      console.log('ファイルサイズ:', (file.size / (1024 * 1024)).toFixed(2), 'MB');
      
      // R2へのアップロード用のURLを取得
      const uploadUrlResponse = await fetch('/api/get-upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileName: file.name, fileKey }),
      });
      
      if (!uploadUrlResponse.ok) {
        throw new Error('アップロードURLの取得に失敗しました');
      }
      
      const { uploadUrl, fileUrl } = await uploadUrlResponse.json();
      console.log('アップロードURL取得成功:', uploadUrl);
      console.log('ファイルURL:', fileUrl);
      
      // ファイルをR2にアップロード
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });
      
      if (!uploadResponse.ok) {
        throw new Error('ファイルのアップロードに失敗しました');
      }
      
      console.log('ファイルアップロード成功');
      setUploadProgress(100);
      setStatusMessage('ファイルのアップロードが完了しました。処理を開始します...');
      
      // データベースにレコードを作成
      const recordResponse = await fetch('/api/records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: file.name,
          file_url: fileUrl,
          file_key: fileKey,
          file_size: file.size,
          status: 'UPLOADED',
        }),
      });
      
      if (!recordResponse.ok) {
        throw new Error('レコードの作成に失敗しました');
      }
      
      const record = await recordResponse.json();
      console.log('レコード作成成功:', record);
      
      // 処理パイプラインを初期化
      const pipeline = new ProcessingPipeline();
      
      // 処理状態を更新
      setUploading(false);
      setIsProcessing(true);
      setStatusMessage('文字起こし処理を開始します...');
      
      try {
        // フロントエンドで直接処理を実行
        console.log('フロントエンドで処理を開始します...');
        
        // 進捗状況の更新関数
        const updateProgress = (stage: string, progress: number) => {
          setStatusMessage(`${stage} (${progress.toFixed(0)}%)`);
          setProcessingProgress(progress);
        };
        
        // 処理パイプラインを実行
        await pipeline.processVideo(record.id, updateProgress);
        
        // 処理完了後、結果ページに遷移
        router.push(`/results?recordId=${record.id}`);
      } catch (processingError) {
        console.error('処理エラー:', processingError);
        setStatusMessage(`処理中にエラーが発生しました: ${processingError instanceof Error ? processingError.message : '不明なエラー'}`);
        setIsProcessing(false);
        setProcessingError(true);
      }
    } catch (error) {
      console.error('アップロードエラー:', error);
      setStatusMessage(`エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
      setUploading(false);
      setUploadError(true);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">動画アップロード</h1>
            <p className="text-slate-600">
              MP4形式の動画ファイル（最大15GB）をアップロードしてください
            </p>
          </div>
          <div className="flex space-x-4">
            <button
              onClick={() => router.push("/results")}
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              処理済み動画を表示
            </button>
          </div>
        </header>

        <div className="rounded-lg bg-white p-8 shadow-md">
          {error && (
            <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-slate-800">Vercel処理</h2>
              <div className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2.5 py-0.5 rounded">
                タイムアウト: 4時間
              </div>
            </div>
            <p className="text-slate-600 mb-4">
              Vercelのサーバーレス関数を使用して処理を行います。処理時間が4時間を超えるとタイムアウトします。
            </p>
          </div>

          <div className="mb-6">
            <label
              htmlFor="video-upload"
              className="block text-sm font-medium text-slate-700"
            >
              動画ファイル
            </label>
            <input
              id="video-upload"
              type="file"
              accept="video/mp4"
              onChange={handleFileChange}
              disabled={uploading}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
            />
            <p className="mt-2 text-sm text-slate-500">
              MP4形式の動画ファイルを選択してください（最大15GB）
            </p>
          </div>

          {file && (
            <div className="mb-6">
              <h3 className="text-md font-medium text-slate-700">
                選択されたファイル
              </h3>
              <p className="text-slate-600">{file.name}</p>
              <p className="text-slate-500">
                {(file.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
          )}

          {uploading && !jobId && (
            <div className="mb-6">
              <h3 className="mb-2 text-md font-medium text-slate-700">
                {uploadStage} - 進捗: {uploadProgress}%
              </h3>
              <div className="h-2 w-full rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-blue-600"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="mt-4 w-full">
              <div className="text-center mb-2">{statusMessage}</div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${processingProgress}%` }}
                ></div>
              </div>
              <div className="text-center mt-2 text-sm text-gray-600">
                処理中はページを閉じないでください。処理が完了すると自動的に結果ページに遷移します。
              </div>
            </div>
          )}

          {jobId && (
            <div className="mb-6">
              <JobProgressMonitor 
                jobId={jobId} 
                onComplete={(result) => {
                  // 処理完了時に結果ページへリダイレクト
                  router.push(`/results?recordId=${result.recordId}`);
                }}
                onError={(error) => {
                  setError(`処理中にエラーが発生しました: ${error}`);
                  setUploading(false);
                  setJobId(null);
                }}
              />
              
              <div className="text-center mt-4">
                <p className="text-sm text-gray-600">
                  処理が完了すると自動的に結果ページに移動します
                </p>
              </div>
            </div>
          )}

          <button
            onClick={() => file && handleFileUpload(file)}
            disabled={!file || uploading}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300"
          >
            {uploading ? "アップロード中..." : "アップロードして処理を開始"}
          </button>
        </div>
      </div>
    </div>
  );
}
