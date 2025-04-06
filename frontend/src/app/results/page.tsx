"use client";

import { useState, useEffect, useRef } from "react"; // useRef をインポート
import { useRouter } from "next/navigation"; // useParams は不要なので削除
import { useSession } from "next-auth/react";
import { Status, Record } from '@prisma/client'; // Status と Record をインポート
import ProgressIndicator from "../components/ProgressIndicator";
import ContentModal from "../components/ContentModal";
import TimestampList from "../components/TimestampList";
import VideoPlayer from "../components/VideoPlayer";

export const dynamic = 'force-dynamic'; // 動的レンダリングを強制

export default function ResultsPage() {
  const { data: session, status: sessionStatus } = useSession(); // status 変数名を変更
  const router = useRouter();
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // モーダル表示用の状態
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState<string | null>(null);

  // セッションチェック
  if (sessionStatus === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">読み込み中...</h2>
          <p>ユーザー情報を確認しています</p>
        </div>
      </div>
    );
  }

  if (sessionStatus === "unauthenticated") {
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
      // APIからのデータが { records: [], pagination: {} } 形式であることを確認
      if (data && Array.isArray(data.records)) {
        setRecords(data.records);
      } else {
        console.error("APIからのレコードデータ形式が不正:", data);
        setRecords([]); // 不正な場合は空にする
      }
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

  // 初期表示
  useEffect(() => {
    fetchRecords(); // 初回読み込み
  }, []); // 初回マウント時のみ実行

  // ポーリング専用のuseEffect
  useEffect(() => {
    // ポーリング設定関数
    const setupPolling = () => {
      // 既存のインターバルがあればクリア
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null; // クリアしたことを明示
        // console.log("既存のポーリングをクリア"); // デバッグ用ログはコメントアウト推奨
      }

       // 処理中のレコードがあるか確認
       const isProcessing = records.some(r =>
         r.status === Status.PROCESSING || r.status === Status.UPLOADED ||
         r.status === Status.TRANSCRIBED || r.status === Status.SUMMARIZED
       );

       // 処理中のレコードがあり、かつローディング中でなければポーリング開始
       if (isProcessing && !loading) {
         // console.log("処理中のレコードがあるためポーリング開始/継続"); // デバッグ用ログはコメントアウト推奨
         pollingIntervalRef.current = setInterval(() => {
           // console.log("一覧画面ポーリング実行"); // デバッグ用ログはコメントアウト推奨
           fetchRecords(); // fetchRecords内で再度 isProcessing を評価し、不要なら停止する
         }, 5000); // 5秒間隔
       } else {
         // 処理中のものがなければポーリング停止 (既に停止している場合も含む)
         if (pollingIntervalRef.current) {
             // console.log("処理中のレコードがない、またはローディング中のためポーリング停止"); // デバッグ用ログはコメントアウト推奨
             clearInterval(pollingIntervalRef.current);
             pollingIntervalRef.current = null;
         } else {
             // console.log("処理中のレコードがない、またはローディング中のためポーリングせず"); // デバッグ用ログはコメントアウト推奨
         }
       }
    };

    // loading完了後、またはrecordsが更新された後にポーリング設定を実行
    if (!loading) {
        setupPolling();
    }

    // クリーンアップ関数
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        // console.log("コンポーネントアンマウントによりポーリング停止"); // デバッグ用ログはコメントアウト推奨
      }
    };
  // loading と records の変更を監視してポーリングを再設定/停止
  }, [loading, records]); // records を依存配列に追加

  // 処理のリトライ
  const handleRetry = async (recordId: string) => {
    try {
      setError(""); // エラー表示をクリア
      const response = await fetch(`/api/records/${recordId}/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "処理の再試行に失敗しました");
      }

      // 再取得して表示を更新
      fetchRecords(); // fetchRecordsを呼び出す
    } catch (err) {
      console.error("リトライエラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "処理の再試行中にエラーが発生しました"
      );
    }
  };

  // 特定のステップから処理を再開するAPIエンドポイントが存在しないためコメントアウト
  // const handleRetryFromStep = async (recordId: string, step: number) => {
  //   try {
  //     setError(""); // エラー表示をクリア
  //     const response = await fetch(`/api/records/${recordId}/retry-step`, { // APIエンドポイント名を修正 (仮)
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify({ step }),
  //     });

  //     if (!response.ok) {
  //       const errorData = await response.json();
  //       throw new Error(errorData.error || "処理の再開に失敗しました");
  //     }

  //     // 再取得して表示を更新
  //     fetchRecords(); // fetchRecordsを呼び出す
  //   } catch (err) {
  //     console.error("ステップ再開エラー:", err);
  //     setError(
  //       err instanceof Error
  //         ? err.message
  //         : "処理の再開中にエラーが発生しました"
  //     );
  //   }
  // };

  // レコードの削除
  const handleDelete = async (recordId: string) => {
    if (!confirm("このレコードを削除してもよろしいですか？")) {
      return;
    }

    try {
      setLoading(true); // 削除処理中はローディング表示
      setError(""); // エラー表示をクリア

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
      fetchRecords(); // fetchRecordsを呼び出す
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
        // processing_progress を見てより正確に判断
        if (record.processing_progress && record.processing_progress >= 80) return 3; // 保存中以降
        if (record.processing_progress && record.processing_progress >= 10) return 2; // 音声処理中
        return 1; // ダウンロード中など
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
              onClick={() => router.push("/logs")} // ログページへのリンク (仮)
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

        {loading && records.length === 0 ? ( // 初回ロード中のみ表示
          <div className="rounded-lg bg-white p-8 text-center shadow-md">
            <p className="text-slate-600">データを読み込んでいます...</p>
          </div>
        ) : !loading && records.length === 0 ? ( // ロード完了後、データがない場合
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
                  {/* ファイル名表示を修正 */}
                  {record.file_name || record.file_url?.split("/").pop() || "ファイル名なし"}
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
                      onRetry={() => handleRetry(record.id)} // 正しい関数名を渡す
                      // onRetryStep は現在APIがないためコメントアウト
                      // onRetryStep={(step) => handleRetryFromStep(record.id, step)}
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

                {/* DONE ステータスでなくても詳細表示ボタンは表示 */}
                <button
                  onClick={() => router.push(`/results/${record.id}`)}
                  className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  詳細を表示
                </button>

                {/* 一覧画面では結果のプレビューは表示しない */}
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
