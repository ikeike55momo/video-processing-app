"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [systemStatus, setSystemStatus] = useState({
    apiLimits: { gemini: "OK", claude: "OK" },
    storage: "OK",
    database: "OK",
  });

  // セッションチェックと管理者権限の確認
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated") {
      // 管理者権限チェック
      if (session?.user && 'role' in session.user && session.user.role !== "ADMIN") {
        router.push("/dashboard");
      }
    }
  }, [status, session, router]);

  // ローディング表示
  if (status === "loading" || (status === "authenticated" && session?.user && !('role' in session.user))) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">読み込み中...</h2>
          <p>ユーザー情報を確認しています</p>
        </div>
      </div>
    );
  }

  // 管理者でない場合は表示しない
  if (status === "authenticated" && session?.user && 'role' in session.user && session.user.role !== "ADMIN") {
    return null;
  }

  // 全ての処理レコードを取得
  useEffect(() => {
    const fetchAllRecords = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/admin/records");
        
        if (!response.ok) {
          throw new Error("処理レコードの取得に失敗しました");
        }
        
        const data = await response.json();
        setRecords(data.records);
      } catch (err) {
        console.error("データ取得エラー:", err);
        setError(
          err instanceof Error
            ? err.message
            : "データの取得中にエラーが発生しました"
        );
      } finally {
        setLoading(false);
      }
    };

    // システムステータスの取得
    const fetchSystemStatus = async () => {
      try {
        const response = await fetch("/api/admin/status");
        
        if (!response.ok) {
          throw new Error("システムステータスの取得に失敗しました");
        }
        
        const data = await response.json();
        setSystemStatus(data);
      } catch (err) {
        console.error("ステータス取得エラー:", err);
      }
    };

    if (status === "authenticated" && session?.user && 'role' in session.user && session.user.role === "ADMIN") {
      fetchAllRecords();
      fetchSystemStatus();
    }
  }, [status, session]);

  // 処理のリトライ
  const handleRetry = async (recordId: string) => {
    try {
      const response = await fetch(`/api/admin/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ recordId }),
      });

      if (!response.ok) {
        throw new Error("処理の再試行に失敗しました");
      }

      // 再取得して表示を更新
      const updatedResponse = await fetch("/api/admin/records");
      const data = await updatedResponse.json();
      setRecords(data.records);
    } catch (err) {
      console.error("リトライエラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "処理の再試行中にエラーが発生しました"
      );
    }
  };

  // ステータスに応じた色を返す
  const getStatusColor = (status: string) => {
    switch (status) {
      case "DONE":
        return "bg-green-100 text-green-800";
      case "PROCESSING":
        return "bg-blue-100 text-blue-800";
      case "ERROR":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  // システムステータスの色を返す
  const getSystemStatusColor = (status: string) => {
    return status === "OK" 
      ? "bg-green-100 text-green-800" 
      : "bg-red-100 text-red-800";
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800">管理パネル</h1>
          <p className="text-slate-600">
            システムステータスと処理状況のモニタリング
          </p>
        </header>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* システムステータス */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow-md">
          <h2 className="mb-4 text-xl font-semibold text-slate-800">
            システムステータス
          </h2>
          
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 p-4">
              <h3 className="mb-2 font-medium text-slate-700">API制限</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Gemini 2.0:</span>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${getSystemStatusColor(systemStatus.apiLimits.gemini)}`}>
                    {systemStatus.apiLimits.gemini}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Claude Sonnet 3.7:</span>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${getSystemStatusColor(systemStatus.apiLimits.claude)}`}>
                    {systemStatus.apiLimits.claude}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="rounded-md border border-slate-200 p-4">
              <h3 className="mb-2 font-medium text-slate-700">ストレージ</h3>
              <div className="flex items-center justify-between">
                <span>Google Cloud Storage:</span>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${getSystemStatusColor(systemStatus.storage)}`}>
                  {systemStatus.storage}
                </span>
              </div>
            </div>
            
            <div className="rounded-md border border-slate-200 p-4">
              <h3 className="mb-2 font-medium text-slate-700">データベース</h3>
              <div className="flex items-center justify-between">
                <span>Neon PostgreSQL:</span>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${getSystemStatusColor(systemStatus.database)}`}>
                  {systemStatus.database}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 処理レコード一覧 */}
        <div className="rounded-lg bg-white p-6 shadow-md">
          <h2 className="mb-4 text-xl font-semibold text-slate-800">
            処理レコード
          </h2>

          {loading ? (
            <p className="text-center text-slate-600">データを読み込んでいます...</p>
          ) : records.length === 0 ? (
            <p className="text-center text-slate-600">処理レコードはありません</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      ID
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      ファイル
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      ステータス
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      作成日時
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      アクション
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                        {record.id.substring(0, 8)}...
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                        {record.file_url.split("/").pop()}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusColor(record.status)}`}>
                          {record.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                        {new Date(record.created_at).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                        <button
                          onClick={() => router.push(`/results/${record.id}`)}
                          className="mr-2 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-200"
                        >
                          詳細
                        </button>
                        {record.status === "ERROR" && (
                          <button
                            onClick={() => handleRetry(record.id)}
                            className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-200"
                          >
                            再試行
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
