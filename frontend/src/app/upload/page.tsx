"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { uploadMultipart } from "@/lib/storage"; // Assuming this handles multipart correctly
import JobProgressMonitor from "../components/JobProgressMonitor";

export default function UploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [uploadStage, setUploadStage] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null); // Can be BullMQ jobId or recordId
  const [recordId, setRecordId] = useState<string | null>(null); // Store the actual recordId
  const [isJobComplete, setIsJobComplete] = useState(false); // State to track completion

  // Session check effect
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // セッションチェック
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <h2 className="text-xl font-semibold mt-4">読み込み中...</h2>
          <p>ユーザー情報を確認しています</p>
        </div>
      </div>
    );
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    setError("");
    setFile(null);
    setJobId(null);
    setRecordId(null);
    setUploading(false);
    setUploadProgress(0);
    setUploadStage("");
    setIsJobComplete(false);

    if (!selectedFile) {
      return;
    }

    if (selectedFile.type !== "video/mp4") {
      setError("MP4形式の動画ファイルのみアップロード可能です");
      return;
    }

    const maxSize = 15 * 1024 * 1024 * 1024; // 15GB
    if (selectedFile.size > maxSize) {
      setError("ファイルサイズは15GB以下にしてください");
      return;
    }

    setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) {
      setError("ファイルを選択してください");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStage("署名付きURL取得中...");
    setError("");
    setJobId(null);
    setRecordId(null);
    setIsJobComplete(false);

    try {
      // 1. Get Upload URL and Record ID - ファイルサイズに応じた適切なアップロードURLを取得
      const uploadUrlResponse = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      });

      if (!uploadUrlResponse.ok) {
        throw new Error(`署名付きURLの取得に失敗しました: ${uploadUrlResponse.statusText}`);
      }

      const uploadUrlResult = await uploadUrlResponse.json();
      const { uploadUrl, recordId: generatedRecordId, fileKey, fileUrl: publicFileUrl, isMultipart } = uploadUrlResult;

      if (!generatedRecordId || !fileKey) {
        throw new Error("サーバーから必要なアップロード情報が返されませんでした。");
      }

      setRecordId(generatedRecordId); // Store the generated record ID

      // 2. Upload File - マルチパートアップロードかどうかで処理を分岐
      setUploadStage("アップロード中...");
      
      if (isMultipart) {
        // マルチパートアップロードの場合
        console.log("マルチパートアップロードを開始します");
        await uploadMultipart(file, uploadUrlResult, (progress) => {
          setUploadProgress(progress);
        });
      } else {
        // 通常のアップロードの場合
        console.log("通常のアップロードを開始します");
        await uploadFileWithProgress(file, uploadUrl);
      }
      
      console.log("アップロード成功");

      // 3. Start Processing
      setUploadStage("処理を開始中...");
      const processResponse = await fetch(`/api/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: generatedRecordId,
          fileKey: fileKey,
          fileUrl: publicFileUrl,
        }),
      });

      if (!processResponse.ok) {
        const errorData = await processResponse.json();
        console.error("処理開始APIエラー:", errorData);
        throw new Error(`処理の開始に失敗しました: ${errorData.error || processResponse.statusText}`);
      }

      const processResult = await processResponse.json();
      const returnedJobId = processResult.jobId;

      if (!returnedJobId) {
        console.warn("バックエンドAPIからジョブIDが返されませんでした。レコードIDで監視します。");
        setJobId(generatedRecordId);
      } else {
        console.log(`処理開始API成功: jobId=${returnedJobId}`);
        setJobId(returnedJobId);
      }

      setUploadStage("処理中...");
      
      // 処理開始後、すぐに結果ページにリダイレクト
      console.log(`処理が開始されました。結果ページにリダイレクトします: ${generatedRecordId}`);
      router.push(`/results/${generatedRecordId}`);

    } catch (err) {
      console.error("アップロードまたは処理開始エラー:", err);
      setError(err instanceof Error ? err.message : "アップロードまたは処理開始中にエラーが発生しました");
      setUploading(false);
      setJobId(null);
      setRecordId(null);
    }
  };

  const uploadFileWithProgress = (file: File, signedUrl: string) => {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signedUrl, true);
      xhr.setRequestHeader("Content-Type", file.type);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`アップロード失敗: ${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("アップロード中にネットワークエラーが発生しました"));
      xhr.onabort = () => reject(new Error("アップロードが中断されました"));
      xhr.ontimeout = () => reject(new Error("アップロードがタイムアウトしました"));
      xhr.timeout = 14400000; // 4 hours
      xhr.send(file);
    });
  };

  const handleProcessingComplete = (result: any) => {
    console.log("Processing complete callback triggered", result);
    // setIsJobComplete(true); // Let JobProgressMonitor handle redirect
  };

  const handleProcessingError = (error: any) => {
    console.error("Processing error callback triggered", error);
    setError(`処理中にエラーが発生しました: ${error}`);
    setUploading(false);
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

          {/* JobProgressMonitorコンポーネントを追加 */}
          {jobId && recordId && (
            <div className="mb-6">
              <JobProgressMonitor
                jobId={jobId}
                recordIdProp={recordId}
                onComplete={handleProcessingComplete}
                onError={handleProcessingError}
              />
            </div>
          )}

          <button
            onClick={handleUpload}
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
