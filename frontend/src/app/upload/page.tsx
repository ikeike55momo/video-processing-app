"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { uploadMultipart } from "@/lib/storage";
import JobProgressMonitor from "../components/JobProgressMonitor";

export default function UploadPage() {
  const { data: session } = useSession({
    required: true,
    onUnauthenticated() {
      // リダイレクトはサーバーサイドで処理されるため、ここでは何もしない
    },
  });

  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>("");
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStage, setUploadStage] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");

  // ファイル選択ハンドラー
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    // ファイルサイズチェック（15GBまで）
    const MAX_SIZE = 15 * 1024 * 1024 * 1024; // 15GB
    if (selectedFile.size > MAX_SIZE) {
      setError(
        `ファイルサイズが大きすぎます。15GB以下のファイルを選択してください。（現在: ${(
          selectedFile.size /
          (1024 * 1024 * 1024)
        ).toFixed(2)}GB）`
      );
      return;
    }

    // ファイル形式チェック（MP4のみ）
    if (selectedFile.type !== "video/mp4") {
      setError("MP4形式の動画ファイルのみアップロード可能です。");
      return;
    }

    setError("");
    setFile(selectedFile);
  };

  // アップロードハンドラー
  const handleUpload = async () => {
    if (!file) {
      setError("ファイルを選択してください");
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);
      setUploadStage("準備中...");

      // 署名付きURLの取得（ファイルサイズを含める）
      const response = await fetch("/api/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size, // ファイルサイズを送信
        }),
      });

      if (!response.ok) {
        throw new Error(`署名付きURLの取得に失敗しました: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      
      // レスポンスの検証
      if (!result) {
        throw new Error("APIレスポンスが空です");
      }
      
      console.log("アップロードURL取得結果:", result);
      
      let fileUrl: string;

      // アップロード方法の選択
      if (result.isMultipart) {
        // マルチパートアップロードの場合
        setUploadStage("マルチパートアップロード準備中...");
        console.log("マルチパートアップロードを開始します", result);
        
        if (!result.partUrls || !result.key || !result.uploadId) {
          throw new Error("マルチパートアップロードに必要な情報が不足しています");
        }
        
        // マルチパートアップロードの実行
        const uploadResult = await uploadMultipart(file, result, (progress) => {
          setUploadProgress(progress);
          console.log(`マルチパートアップロード進捗: ${progress}%`);
        });
        
        fileUrl = uploadResult.fileUrl;
        console.log("マルチパートアップロード完了:", fileUrl);
      } else {
        // 通常のアップロード
        setUploadStage("アップロード中...");
        
        // uploadUrlが存在するか確認
        if (!result.uploadUrl) {
          console.error("アップロードURLが取得できませんでした", result);
          throw new Error("アップロードURLが取得できませんでした");
        }
        
        await uploadFileWithProgress(file, result.uploadUrl);
        
        if (!result.fileUrl && !result.fileKey) {
          throw new Error("ファイルURLまたはファイルキーが取得できませんでした");
        }
        
        fileUrl = result.fileUrl;
      }

      // 処理開始リクエスト
      setUploadStage("処理を開始中...");
      
      if (!result.fileKey) {
        throw new Error("ファイルキーが取得できませんでした");
      }
      
      const processResponse = await fetch("/api/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileKey: result.fileKey,
          fileName: file.name,
        }),
      });

      if (!processResponse.ok) {
        throw new Error(`処理の開始に失敗しました: ${processResponse.status} ${processResponse.statusText}`);
      }

      const processResult = await processResponse.json();
      
      if (!processResult || !processResult.jobId) {
        throw new Error("処理の開始に失敗しました: 無効なレスポンス");
      }
      
      const { recordId, jobId } = processResult;
      
      // ジョブIDを設定
      setJobId(jobId);
      setUploadStage("処理中...");
      
      // 結果ページへのリダイレクトは行わず、このページで進捗を表示する
      // router.push(`/results?recordId=${recordId}`);
    } catch (err) {
      console.error("アップロードエラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "アップロード中にエラーが発生しました"
      );
      setUploading(false);
    }
  };

  // 進捗表示付きアップロード（小さなファイル用）
  const uploadFileWithProgress = (file: File, signedUrl: string) => {
    return new Promise<void>((resolve, reject) => {
      // signedUrlがundefinedまたは空の場合はエラーを返す
      if (!signedUrl) {
        console.error("署名付きURLが取得できませんでした");
        reject(new Error("署名付きURLが取得できませんでした"));
        return;
      }

      const xhr = new XMLHttpRequest();

      // タイムアウトを設定（4時間 = 14400000ミリ秒）
      xhr.timeout = 14400000;

      xhr.open("PUT", signedUrl, true);
      
      // Content-Typeヘッダーを設定
      xhr.setRequestHeader("Content-Type", file.type);
      
      // CORSを有効にする
      xhr.withCredentials = false;

      // 進捗イベントのリスナー
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
          console.log(`アップロード進捗: ${progress}%`);
        }
      };

      // 成功時のハンドラー
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          console.log("アップロード成功:", xhr.status);
          resolve();
        } else {
          console.error("アップロード失敗:", xhr.status, xhr.statusText, xhr.responseText);
          reject(new Error(`アップロード失敗: ${xhr.status} ${xhr.statusText}`));
        }
      };

      // エラーハンドラー
      xhr.onerror = (e) => {
        console.error("アップロードエラー:", e);
        console.error("署名付きURL:", signedUrl && signedUrl.substring(0, 100) + "...");
        console.error("ファイル情報:", { name: file.name, type: file.type, size: file.size });
        reject(new Error("アップロード中にネットワークエラーが発生しました"));
      };

      // タイムアウトハンドラー
      xhr.ontimeout = () => {
        console.error("アップロードがタイムアウトしました");
        reject(new Error("アップロードがタイムアウトしました"));
      };

      // アップロード中断ハンドラー
      xhr.onabort = () => {
        console.error("アップロードが中断されました");
        reject(new Error("アップロードが中断されました"));
      };

      // ファイル送信
      console.log("アップロード開始:", file.name, file.size, "URL:", signedUrl && signedUrl.substring(0, 100) + "...");
      xhr.send(file);
    });
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
          <button
            onClick={() => router.push("/dashboard")}
            className="px-4 py-2 bg-slate-200 rounded-lg text-slate-700 hover:bg-slate-300 transition"
          >
            ダッシュボードへ戻る
          </button>
        </header>

        <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
          <div className="space-y-6">
            <div>
              <label
                htmlFor="file-upload"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                動画ファイル
              </label>
              <div className="flex items-center space-x-4">
                <label
                  htmlFor="file-upload"
                  className={`flex-1 px-6 py-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition ${
                    file
                      ? "border-green-300 bg-green-50"
                      : "border-slate-300 hover:border-blue-400"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="text-slate-600">
                      {file ? (
                        <span className="text-green-600 font-medium">
                          {file.name} ({(file.size / (1024 * 1024)).toFixed(2)}MB)
                        </span>
                      ) : (
                        <>
                          <span className="font-medium text-blue-600">
                            クリックしてファイルを選択
                          </span>{" "}
                          またはドラッグ＆ドロップ
                        </>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">MP4形式のみ・最大15GB</p>
                  </div>
                  <input
                    id="file-upload"
                    name="file-upload"
                    type="file"
                    accept="video/mp4"
                    className="sr-only"
                    onChange={handleFileChange}
                    disabled={uploading}
                  />
                </label>
                <button
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  className={`px-6 py-3 rounded-lg font-medium ${
                    !file || uploading
                      ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  } transition`}
                >
                  {uploading ? "アップロード中..." : "アップロード"}
                </button>
              </div>
              {error && (
                <p className="mt-2 text-sm text-red-600">{error}</p>
              )}
            </div>

            {uploading && (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{uploadStage}</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            )}

            {jobId && (
              <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="text-lg font-medium text-blue-800 mb-2">
                  処理状況
                </h3>
                <JobProgressMonitor jobId={jobId} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
