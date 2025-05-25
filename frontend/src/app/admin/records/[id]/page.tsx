"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function AdminRecordDetailPage({ params }: { params: { id: string } }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [record, setRecord] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);

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

  // レコード詳細の取得
  useEffect(() => {
    const fetchRecordDetail = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/admin/records/${params.id}`);
        
        if (!response.ok) {
          throw new Error("レコード詳細の取得に失敗しました");
        }
        
        const data = await response.json();
        setRecord(data.record);
        setLogs(data.logs);
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

    if (status === "authenticated" && session?.user && 'role' in session.user && session.user.role === "ADMIN" && params.id) {
      fetchRecordDetail();
    }
  }, [status, session, params.id]);

  // 処理のリトライ
  const handleRetry = async () => {
    try {
      setRetrying(true);
      const response = await fetch(`/api/admin/records/${params.id}/retry`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("処理の再試行に失敗しました");
      }

      // 成功メッセージを表示
      alert("処理を再試行しました。ダッシュボードに戻ります。");
      router.push("/admin");
    } catch (err) {
      console.error("リトライエラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "処理の再試行中にエラーが発生しました"
      );
      setRetrying(false);
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

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-slate-800">レコード詳細</h1>
            <button
              onClick={() => router.push("/admin")}
              className="rounded-md bg-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
            >
              管理パネルに戻る
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-md">
            <p className="text-slate-600">データを読み込んでいます...</p>
          </div>
        ) : record ? (
          <div className="space-y-6">
            {/* レコード基本情報 */}
            <div className="rounded-lg bg-white p-6 shadow-md">
              <h2 className="mb-4 text-xl font-semibold text-slate-800">
                基本情報
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm text-slate-500">ID</p>
                  <p className="font-medium">{record.id}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">ステータス</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusColor(record.status)}`}>
                    {record.status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-slate-500">ファイルURL</p>
                  <p className="font-medium break-all">{record.file_url}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">作成日時</p>
                  <p className="font-medium">
                    {new Date(record.created_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {record.error && (
                <div className="mt-4">
                  <p className="text-sm text-slate-500">エラー</p>
                  <div className="mt-1 rounded-md bg-red-50 p-3 text-sm text-red-700">
                    {record.error}
                  </div>
                </div>
              )}

              {record.status === "ERROR" && (
                <div className="mt-6">
                  <button
                    onClick={handleRetry}
                    disabled={retrying}
                    className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300"
                  >
                    {retrying ? "再試行中..." : "処理を再試行"}
                  </button>
                </div>
              )}
            </div>

            {/* 処理ログ */}
            <div className="rounded-lg bg-white p-6 shadow-md">
              <h2 className="mb-4 text-xl font-semibold text-slate-800">
                処理ログ
              </h2>
              {logs.length === 0 ? (
                <p className="text-center text-slate-500">ログはありません</p>
              ) : (
                <div className="space-y-3">
                  {logs.map((log, index) => (
                    <div key={index} className="flex items-start border-l-2 border-blue-500 pl-4">
                      <div>
                        <p className="text-xs text-slate-500">
                          {new Date(log.timestamp).toLocaleString()}
                        </p>
                        <p className="text-sm">{log.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 処理結果 */}
            <div className="rounded-lg bg-white p-6 shadow-md">
              <h2 className="mb-4 text-xl font-semibold text-slate-800">
                処理結果
              </h2>
              <div className="space-y-6">
                <div>
                  <h3 className="mb-2 text-lg font-medium text-slate-700">
                    文字起こし
                  </h3>
                  <div className="max-h-60 overflow-y-auto rounded-md bg-slate-50 p-4 text-sm">
                    {record.transcript_text || "文字起こしはまだ生成されていません"}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-lg font-medium text-slate-700">
                    要約
                  </h3>
                  <div className="max-h-60 overflow-y-auto rounded-md bg-slate-50 p-4 text-sm">
                    {record.summary_text || "要約はまだ生成されていません"}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-lg font-medium text-slate-700">
                    生成された記事
                  </h3>
                  <div className="max-h-60 overflow-y-auto rounded-md bg-slate-50 p-4 text-sm">
                    {record.article_text || "記事はまだ生成されていません"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-white p-8 text-center shadow-md">
            <p className="text-slate-600">レコードが見つかりません</p>
          </div>
        )}
      </div>
    </div>
  );
}
