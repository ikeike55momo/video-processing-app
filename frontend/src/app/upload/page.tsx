"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { uploadMultipart } from "@/lib/storage";
import JobProgressMonitor from "../components/JobProgressMonitor";

// 環境変数の読み込み確認
const checkR2Config = async () => {
  try {
    // フロントエンドの環境変数をチェック
    const response = await fetch('/api/check-env', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('環境変数チェックAPIエラー:', response.status);
      return { isConfigured: false, error: `APIエラー: ${response.status}` };
    }

    const config = await response.json();
    console.log('環境変数チェック（クライアントサイド）:', config);
    
    // APIレスポンスにisConfiguredフラグが含まれている場合はそれを使用
    if ('isConfigured' in config) {
      return config;
    }
    
    // そうでない場合は、必要な環境変数が設定されているか確認
    const isConfigured = 
      config.hasAccessKey && 
      config.hasSecretKey && 
      config.hasEndpoint && 
      config.hasBucket;
    
    return { 
      isConfigured, 
      ...config 
    };
  } catch (error: any) {
    console.error('環境変数チェックエラー:', error);
    return { isConfigured: false, error: error.message };
  }
};

export default function UploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [uploadStage, setUploadStage] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null);

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

  // アップロードハンドラー
  const handleUpload = async () => {
    if (!file) {
      setError("ファイルを選択してください");
      return;
    }

    try {
      // 環境変数が読み込まれているか確認
      const r2Config = await checkR2Config();
      if (!r2Config.isConfigured) {
        setError("ストレージ設定が読み込まれていません。しばらく待ってから再試行してください。");
        console.error("R2設定エラー:", r2Config);
        return;
      }

      setUploading(true);
      setUploadProgress(0);
      setUploadStage("準備中...");

      // バックエンドAPIのURLを設定
      // 環境変数から読み込むか、デフォルト値を使用
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 
                    "https://api.ririaru-stg.cloud"; // 新しいカスタムドメインを使用
      
      console.log("使用するAPIエンドポイント:", apiUrl);
      
      // 最大3回まで再試行
      let response;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          setUploadStage(`APIに接続中... (試行 ${retryCount + 1}/${maxRetries})`);
          
          // 同一オリジンのAPIエンドポイントを使用
          response = await fetch(`${apiUrl}/api/upload-url`, {
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
          
          // 成功したらループを抜ける
          if (response.ok) break;
          
          // エラーレスポンスの詳細を取得
          const errorData = await response.text();
          console.error(`APIエラー (${response.status}):`, errorData);
          
          // 再試行
          retryCount++;
          if (retryCount < maxRetries) {
            setUploadStage(`再接続を試みています... (${retryCount}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒待機
          }
        } catch (fetchError: unknown) {
          console.error("フェッチエラー:", fetchError);
          retryCount++;
          if (retryCount < maxRetries) {
            setUploadStage(`再接続を試みています... (${retryCount}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒待機
          } else {
            throw new Error(`APIへの接続に失敗しました: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
          }
        }
      }

      if (!response || !response.ok) {
        throw new Error(`署名付きURLの取得に失敗しました (ステータス: ${response?.status || 'unknown'})`);
      }

      const result = await response.json();
      let fileUrl: string;

      // アップロード方法の選択
      if (result.isMultipart) {
        // マルチパートアップロードの場合
        setUploadStage("マルチパートアップロード準備中...");
        console.log("マルチパートアップロードを開始します", result);
        
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
        
        // URLが存在するか確認（uploadUrlまたはurlを使用）
        const uploadUrl = result.uploadUrl || result.url;
        if (!uploadUrl) {
          console.error("アップロードURLが取得できませんでした:", result);
          throw new Error("アップロードURLが取得できませんでした");
        }
        
        await uploadFileWithProgress(file, uploadUrl);
        fileUrl = result.fileUrl || uploadUrl; // fileUrlがない場合はuploadUrlを使用
      }

      // 処理開始リクエスト
      setUploadStage("処理を開始中...");
      
      // アップロードURLレスポンスの内容をログ出力
      console.log("アップロードURL生成レスポンス:", result);
      
      // 処理開始リクエストの内容をログ出力
      const processRequestBody = {
        recordId: result.recordId, // recordIdパラメータを追加
        fileKey: result.fileKey, // result.keyではなくresult.fileKeyを使用
        fileName: file.name,
        fileUrl: fileUrl
      };
      console.log("処理開始リクエスト内容:", processRequestBody);
      
      const processResponse = await fetch(`${apiUrl}/api/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        mode: "cors", // CORSモードを明示的に指定
        credentials: "omit", // 認証情報を含めない
        body: JSON.stringify(processRequestBody),
      });
      
      // レスポンスの詳細をログ出力
      console.log("処理開始レスポンスステータス:", processResponse.status);
      const responseText = await processResponse.text();
      console.log("処理開始レスポンス内容:", responseText);
      
      if (!processResponse.ok) {
        throw new Error(`処理の開始に失敗しました: ${responseText}`);
      }

      // JSONとして再解析
      const responseData = JSON.parse(responseText);
      const { jobId } = responseData;
      
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
      const xhr = new XMLHttpRequest();

      // タイムアウトを設定（4時間 = 14400000ミリ秒）
      xhr.timeout = 14400000;

      // URLが有効か確認
      if (!signedUrl) {
        console.error("署名付きURLが無効です");
        reject(new Error("署名付きURLが無効です"));
        return;
      }

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
          console.error("アップロード失敗:", xhr.status, xhr.statusText);
          reject(new Error(`アップロード失敗: ${xhr.status} ${xhr.statusText}`));
        }
      };

      // エラーハンドラー
      xhr.onerror = () => {
        console.error("アップロードエラー:", xhr.status);
        reject(new Error("ネットワークエラーが発生しました"));
      };

      // タイムアウトハンドラー
      xhr.ontimeout = () => {
        console.error("アップロードタイムアウト");
        reject(new Error("アップロードがタイムアウトしました"));
      };

      // アップロード開始
      try {
        // URLのログ出力（安全に）
        console.log("アップロード開始:", file.name, file.size, "URL:", signedUrl ? (signedUrl.substring(0, 100) + "...") : "URL未設定");
        xhr.send(file);
      } catch (error) {
        console.error("アップロード送信エラー:", error);
        reject(error);
      }
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
              <h2 className="text-xl font-semibold text-slate-800">動画処理</h2>
              <div className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2.5 py-0.5 rounded">
                タイムアウト: 4時間
              </div>
            </div>
            <p className="text-slate-600 mb-4">
              アップロードした動画の文字起こし、要約、記事生成を行います。処理時間が4時間を超えるとタイムアウトします。
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
