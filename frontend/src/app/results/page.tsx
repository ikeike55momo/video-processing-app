"use client";

import { useState, useEffect, useRef } from "react"; // useRef をインポート
import { useRouter, useParams } from "next/navigation"; // useParams をインポート
import { useSession } from "next-auth/react";
import { Status, Record } from '@prisma/client'; // PrismaClient は不要なので削除
import ProgressIndicator from "../components/ProgressIndicator";
import ContentModal from "../components/ContentModal";
import TimestampList from "../components/TimestampList";
import VideoPlayer from "../components/VideoPlayer";
// import { Record } from "@/types/record"; // Prismaの型を使用

export default function ResultsPage() {
  const { data: session, status: sessionStatus } = useSession(); // status 変数名を変更
  const router = useRouter();
  const params = useParams(); // useParams を使用
  const urlRecordId = params?.id as string; // URLパラメータから取得するID (詳細ページ用だが、ここでは使わない想定)
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // モーダル表示用の状態
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState<string | null>(null);

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

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null); // ポーリングのインターバルIDを保持

  // レコード一覧取得関数
  const fetchRecords = async () => {
    try {
      // setLoading(true); // ポーリング中はローディング表示しない方が自然な場合も
      const response = await fetch("/api/records");

      if (!response.ok) {
        throw new Error("処理済み動画の取得に失敗しました");
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
      setLoading(false); // 初回読み込み完了
    }
  };

  // 初期表示とポーリング設定
  useEffect(() => {
    fetchRecords(); // 初回読み込み

    // ポーリング設定
    const setupPolling = () => {
      // 既存のインターバルがあればクリア
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

      // 新しいインターバルを設定
      pollingIntervalRef.current = setInterval(() => {
        // 処理中のレコードがあるか確認
        const isProcessing = records.some(r =>
          r.status === Status.PROCESSING || r.status === Status.UPLOADED ||
          r.status === Status.TRANSCRIBED || r.status === Status.SUMMARIZED
        );

        if (isProcessing && !loading) { // ローディング中でない場合のみ実行
          console.log("一覧画面ポーリング実行");
          fetchRecords();
        } else if (!isProcessing) {
           // 処理中のものがなければポーリング停止
           console.log("処理中のレコードがないため一覧ポーリング停止");
           if (pollingIntervalRef.current) {
             clearInterval(pollingIntervalRef.current);
             pollingIntervalRef.current = null;
           }
        }
      }, 5000); // 5秒間隔
    };

    setupPolling(); // ポーリング開始

    // クリーンアップ関数
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  // loading と records の変更を監視してポーリングを再設定
  }, [loading, records]);

  // 処理のリトライ
  const handleRetry = async (recordId: string) => {
    try {
      const response = await fetch(`/api/records/${recordId}/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("処理の再試行に失敗しました");
      }

      // 再取得して表示を更新
      const updatedResponse = await fetch("/api/records");
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

  // 特定のステップから処理を再開
  const handleRetryFromStep = async (recordId: string, step: number) => {
    try {
      const response = await fetch(`/api/records/${recordId}/retry-step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ step }),
      });

      if (!response.ok) {
        throw new Error("処理の再開に失敗しました");
      }

      // 再取得して表示を更新
      const updatedResponse = await fetch("/api/records");
      const data = await updatedResponse.json();
      setRecords(data.records);
    } catch (err) {
      console.error("ステップ再開エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "処理の再開中にエラーが発生しました"
      );
    }
  };

  // レコードの削除
  const handleDelete = async (recordId: string) => {
    if (!confirm("このレコードを削除してもよろしいですか？")) {
      return;
    }
    
    try {
      setLoading(true); // 削除処理中はローディング表示
      
      const response = await fetch(`/api/records/${recordId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "レコードの削除に失敗しました");
      }

      // 削除成功メッセージ
      alert("レコードを削除しました");
      
      // 再取得して表示を更新
      const updatedResponse = await fetch("/api/records");
      const data = await updatedResponse.json();
      setRecords(data.records);
    } catch (err) {
      console.error("削除エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "レコードの削除中にエラーが発生しました"
      );
    } finally {
      setLoading(false); // 処理完了後にローディング表示を解除
    }
  };

   // 処理ステップの計算 (ステータスベース、Status enum を使用)
   const calculateStep = (record: Record) => {
    if (!record) return 1;

    switch (record.status) {
      case Status.ERROR: // Status enum を使用
        // エラー発生前の状態に基づいて返す
        if (record.article_text) return 4;
        if (record.summary_text) return 3;
        if (record.transcript_text) return 1; // 文字起こしは完了していたと仮定
        return 1;
      case Status.DONE: // Status enum を使用
        return 5;
      case Status.SUMMARIZED: // Status enum を使用
        return 4;
      case Status.TRANSCRIBED: // Status enum を使用
        return 3;
      case Status.PROCESSING: // Status enum を使用
        // processing_step を見てより正確に判断することも可能
        return 2;
      case Status.UPLOADED: // Status enum を使用
        return 1;
      default:
        console.warn("Unknown record status in list:", record.status);
        return 1;
    }
  };

  // モーダルを開く関数
  const openModal = (title: string, content: string | null) => {
    setModalTitle(title);
    setModalContent(content);
    setModalOpen(true);
  };

  // モーダルを閉じる関数
  const closeModal = () => {
    setModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">処理済み動画</h1>
            <p className="text-slate-600">
              アップロードした動画の処理状況と結果を確認できます
            </p>
          </div>
          <div>
            <button
              onClick={() => router.push("/logs")}
              className="rounded-md bg-slate-600 px-4 py-2 text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
            >
              システムログを表示
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
        ) : records.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-md">
            <p className="text-slate-600">処理済みの動画はありません</p>
            <button
              onClick={() => router.push("/upload")}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              動画をアップロードする
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {records.map((record) => (
              <div
                key={record.id}
                className="rounded-lg bg-white p-6 shadow-md"
              >
                <h2 className="mb-2 text-xl font-semibold text-slate-800">
                  {record.file_url?.split("/").pop() || "ファイル名なし"}
                </h2>
                <p className="mb-4 text-sm text-slate-500">
                  アップロード日時: {new Date(record.created_at).toLocaleString()}
                </p>

                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <ProgressIndicator
                      currentStep={calculateStep(record)}
                      totalSteps={5}
                      status={record.status}
                      error={record.error}
                      onRetry={() => handleRetry(record.id)}
                      onRetryStep={(step) => handleRetryFromStep(record.id, step)}
                    />
                  </div>
                  <button
                    onClick={() => handleDelete(record.id)}
                    className="ml-4 rounded-md bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                    title="このレコードを削除"
                  >
                    削除
                  </button>
                </div>

                {record.status === "DONE" && (
                  <div className="mt-6 space-y-4">
                    <div>
                      <h3 className="text-md font-medium text-slate-700">
                        文字起こし
                      </h3>
                      <div className="mt-2 max-h-40 overflow-y-auto rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                        {record.transcript_text
                          ? record.transcript_text.substring(0, 300) + "..."
                          : "文字起こしはありません"}
                      </div>
                      {record.transcript_text && (
                        <button
                          onClick={() => openModal("文字起こし 全文", record.transcript_text)}
                          className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                        >
                          全文を表示
                        </button>
                      )}
                    </div>

                    <div>
                      <h3 className="text-md font-medium text-slate-700">
                        タイムスタンプ
                      </h3>
                      <div className="mt-2 rounded-md bg-slate-50 p-3">
                        {record.timestamps_json ? (
                          <TimestampList 
                            timestamps={JSON.parse(record.timestamps_json)} 
                            videoUrl={record.file_url || ""}
                          />
                        ) : (
                          <div className="text-sm text-slate-500 italic">
                            タイムスタンプはありません
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-md font-medium text-slate-700">
                        要約
                      </h3>
                      <div className="mt-2 max-h-40 overflow-y-auto rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                        {record.summary_text
                          ? record.summary_text.substring(0, 300) + "..."
                          : "要約はありません"}
                      </div>
                      {record.summary_text && (
                        <button
                          onClick={() => openModal("要約 全文", record.summary_text)}
                          className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                        >
                          全文を表示
                        </button>
                      )}
                    </div>

                    <div>
                      <h3 className="text-md font-medium text-slate-700">
                        生成された記事
                      </h3>
                      <div className="mt-2 max-h-40 overflow-y-auto rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                        {record.article_text
                          ? record.article_text.substring(0, 300) + "..."
                          : "記事はありません"}
                      </div>
                      {record.article_text && (
                        <button
                          onClick={() => openModal("記事 全文", record.article_text)}
                          className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                        >
                          全文を表示
                        </button>
                      )}
                    </div>

                    {record.file_url && (
                      <div className="mt-6">
                        <h3 className="text-md font-medium text-slate-700 mb-2">
                          動画プレーヤー
                        </h3>
                        <VideoPlayer 
                          src={record.file_url} 
                          timestamps={record.timestamps_json ? JSON.parse(record.timestamps_json) : []}
                        />
                      </div>
                    )}

                    <button
                      onClick={() => router.push(`/results/${record.id}`)}
                      className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      詳細を表示
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* モーダルコンポーネント */}
      <ContentModal
        isOpen={modalOpen}
        onClose={closeModal}
        title={modalTitle}
        content={modalContent}
      />
    </div>
  );
}
