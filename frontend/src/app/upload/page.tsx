"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function UploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");

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

    // ファイルサイズチェック (6GB = 6 * 1024 * 1024 * 1024 bytes)
    const maxSize = 6 * 1024 * 1024 * 1024;
    if (selectedFile.size > maxSize) {
      setError("ファイルサイズは6GB以下にしてください");
      return;
    }

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

      // 署名付きURLの取得
      const response = await fetch("/api/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
        }),
      });

      if (!response.ok) {
        throw new Error("署名付きURLの取得に失敗しました");
      }

      const { url, fileUrl } = await response.json();

      // ファイルのアップロード（進捗表示付き）
      await uploadFileWithProgress(file, url);

      // 処理開始リクエスト
      const processResponse = await fetch("/api/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileUrl,
        }),
      });

      if (!processResponse.ok) {
        throw new Error("処理の開始に失敗しました");
      }

      const { recordId } = await processResponse.json();

      // 結果ページへリダイレクト（recordIdを指定）
      router.push(`/results?recordId=${recordId}`);
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

  // 進捗表示付きアップロード（大きなファイル対応）
  const uploadFileWithProgress = (file: File, signedUrl: string) => {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // タイムアウトを設定（2時間 = 7200000ミリ秒）
      xhr.timeout = 7200000;

      xhr.open("PUT", signedUrl, true);
      xhr.setRequestHeader("Content-Type", file.type);

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
          console.error("アップロード失敗:", xhr.status, xhr.statusText);
          reject(new Error(`アップロード失敗: ${xhr.status} ${xhr.statusText}`));
        }
      };

      // エラーハンドラー
      xhr.onerror = (e) => {
        console.error("アップロードエラー:", e);
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
      console.log("アップロード開始:", file.name, file.size);
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
              MP4形式の動画ファイル（最大6GB）をアップロードしてください
            </p>
          </div>
          <div className="flex space-x-4">
            <button
              onClick={() => router.push("/upload/cloud-upload")}
              className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              Cloud Run処理を使用
            </button>
            <button
              onClick={() => router.push("/results")}
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              処理済み動画を表示
            </button>
            <button
              onClick={() => router.push("/logs")}
              className="rounded-md bg-slate-600 px-4 py-2 text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
            >
              システムログを表示
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
                タイムアウト: 10秒
              </div>
            </div>
            <p className="text-slate-600 mb-4">
              Vercelのサーバーレス関数を使用して処理を行います。処理時間が10秒を超えると失敗する可能性があります。
              大きなファイルや長時間の処理が必要な場合は、「Cloud Run処理を使用」ボタンをクリックしてください。
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
              MP4形式の動画ファイルを選択してください（最大6GB）
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

          {uploading && (
            <div className="mb-6">
              <h3 className="mb-2 text-md font-medium text-slate-700">
                アップロード進捗: {uploadProgress}%
              </h3>
              <div className="h-2 w-full rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-blue-600"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
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
