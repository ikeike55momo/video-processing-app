"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function LogsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [logs, setLogs] = useState<string[]>([]);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

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

  // ログの取得
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/admin/logs");
        
        if (!response.ok) {
          throw new Error("ログの取得に失敗しました");
        }
        
        const data = await response.json();
        setLogs(data.logs || []);
        setSystemStatus(data.systemStatus || null);
      } catch (err) {
        console.error("ログ取得エラー:", err);
        setError(
          err instanceof Error
            ? err.message
            : "ログの取得中にエラーが発生しました"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();

    // 自動更新
    let interval: NodeJS.Timeout | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchLogs, 5000); // 5秒ごとに更新
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">システムログ</h1>
            <p className="text-slate-600">
              アプリケーションのログを確認できます
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-4 py-2 rounded-md ${
                autoRefresh
                  ? "bg-green-600 text-white"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {autoRefresh ? "自動更新中" : "自動更新オフ"}
            </button>
            <button
              onClick={async () => {
                try {
                  // 最新のレコードを取得
                  const response = await fetch("/api/records");
                  if (!response.ok) {
                    throw new Error("レコードの取得に失敗しました");
                  }
                  const data = await response.json();
                  
                  if (data.records && data.records.length > 0) {
                    // 最新のレコードを取得
                    const latestRecord = data.records[0];
                    
                    // リトライリクエストを送信
                    const retryResponse = await fetch(`/api/retry`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ recordId: latestRecord.id }),
                    });
                    
                    if (!retryResponse.ok) {
                      throw new Error("処理の再試行に失敗しました");
                    }
                    
                    alert("処理を再開しました。しばらくお待ちください。");
                  } else {
                    alert("処理対象のレコードが見つかりません");
                  }
                } catch (err) {
                  console.error("リトライエラー:", err);
                  alert(err instanceof Error ? err.message : "エラーが発生しました");
                }
              }}
              className="px-4 py-2 rounded-md bg-yellow-600 text-white hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2"
            >
              処理を再開
            </button>
            <button
              onClick={() => router.push("/results")}
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              結果ページへ戻る
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* システムステータス表示 */}
        {systemStatus && (
          <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* リソース情報 */}
            <div className="bg-white rounded-lg p-4 shadow-md">
              <h3 className="text-lg font-semibold mb-2 text-slate-800">システムリソース</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-600">メモリ使用量:</span>
                  <span className="font-medium">{systemStatus.resources?.memory?.used} / {systemStatus.resources?.memory?.total} {systemStatus.resources?.memory?.unit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">CPU使用率:</span>
                  <span className="font-medium">{systemStatus.resources?.cpu?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">アップタイム:</span>
                  <span className="font-medium">{systemStatus.resources?.uptime?.hours}時間 {systemStatus.resources?.uptime?.minutes}分</span>
                </div>
              </div>
            </div>

            {/* 処理状況 */}
            <div className="bg-white rounded-lg p-4 shadow-md">
              <h3 className="text-lg font-semibold mb-2 text-slate-800">処理状況</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-600">アップロード済み:</span>
                  <span className="font-medium">{systemStatus.processing?.UPLOADED || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">処理中:</span>
                  <span className="font-medium">{systemStatus.processing?.PROCESSING || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">完了:</span>
                  <span className="font-medium">{systemStatus.processing?.DONE || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">エラー:</span>
                  <span className="font-medium text-red-600">{systemStatus.processing?.ERROR || 0}</span>
                </div>
              </div>
            </div>

            {/* API状態 */}
            <div className="bg-white rounded-lg p-4 shadow-md">
              <h3 className="text-lg font-semibold mb-2 text-slate-800">API状態</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-600">Gemini API:</span>
                  <span className={`font-medium ${systemStatus.api?.gemini === 'OK' ? 'text-green-600' : 'text-red-600'}`}>
                    {systemStatus.api?.gemini || 'Unknown'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Claude API:</span>
                  <span className={`font-medium ${systemStatus.api?.claude === 'OK' ? 'text-green-600' : 'text-red-600'}`}>
                    {systemStatus.api?.claude || 'Unknown'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">データベース:</span>
                  <span className={`font-medium ${systemStatus.api?.database === 'OK' ? 'text-green-600' : 'text-red-600'}`}>
                    {systemStatus.api?.database || 'Unknown'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 最新のエラー表示 */}
        {systemStatus?.errors && systemStatus.errors.length > 0 && (
          <div className="mb-6 bg-white rounded-lg p-4 shadow-md">
            <h3 className="text-lg font-semibold mb-2 text-slate-800">最新のエラー</h3>
            <div className="bg-red-50 p-3 rounded-md">
              <ul className="list-disc list-inside space-y-1 text-sm text-red-700">
                {systemStatus.errors.map((error: string, index: number) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ログ表示 */}
        {loading && logs.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-md">
            <p className="text-slate-600">ログを読み込んでいます...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-md">
            <p className="text-slate-600">ログはありません</p>
          </div>
        ) : (
          <div className="rounded-lg bg-white p-6 shadow-md">
            <div className="mb-4 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-slate-800">
                最新のログ
              </h2>
              <span className="text-sm text-slate-500">
                {new Date().toLocaleString()} 時点
              </span>
            </div>
            <div className="bg-slate-800 text-slate-200 p-4 rounded-md overflow-auto max-h-[70vh]">
              <pre className="whitespace-pre-wrap font-mono text-sm">
                {logs.join("\n")}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
