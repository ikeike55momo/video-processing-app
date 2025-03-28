"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import ProgressIndicator from "../../components/ProgressIndicator";
import ContentModal from "../../components/ContentModal";
import VideoWithTimestamps from "../../components/VideoWithTimestamps";

export default function RecordDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const recordId = params?.id as string;

  const [record, setRecord] = useState<any>(null);
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

  // レコード情報の取得
  useEffect(() => {
    const fetchRecord = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/records/${recordId}`);
        
        if (!response.ok) {
          throw new Error("レコード情報の取得に失敗しました");
        }
        
        const data = await response.json();
        setRecord(data.record);
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
    
    if (recordId) {
      fetchRecord();
    }
  }, [recordId]);

  // 処理ステップの計算
  const calculateStep = (record: any) => {
    if (record.status === "ERROR") return record.lastCompletedStep || 1;
    if (record.status === "DONE") return 5;
    if (record.article_text) return 4;
    if (record.summary_text) return 3;
    if (record.timestamps_json) return 2;
    if (record.transcript_text) return 1;
    return 1;
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

  // タイムスタンプの解析
  const parseTimestamps = (timestampsJson: string | null) => {
    if (!timestampsJson) return [];
    
    try {
      const data = JSON.parse(timestampsJson);
      return data.timestamps || [];
    } catch (error) {
      console.error("タイムスタンプの解析エラー:", error);
      return [];
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">処理結果の詳細</h1>
            <p className="text-slate-600">
              動画の文字起こし、タイムスタンプ、要約、記事を確認できます
            </p>
          </div>
          <div>
            <button
              onClick={() => router.push("/results")}
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              一覧に戻る
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
        ) : !record ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-md">
            <p className="text-slate-600">レコードが見つかりませんでした</p>
            <button
              onClick={() => router.push("/results")}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              一覧に戻る
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 基本情報 */}
            <div className="rounded-lg bg-white p-6 shadow-md">
              <h2 className="mb-2 text-xl font-semibold text-slate-800">
                {record.file_url.split("/").pop()}
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                アップロード日時: {new Date(record.created_at).toLocaleString()}
              </p>

              <ProgressIndicator
                currentStep={calculateStep(record)}
                totalSteps={5}
                status={record.status}
                error={record.error}
              />
            </div>

            {/* 動画プレーヤーとタイムスタンプ */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-slate-800 mb-2">タイムスタンプ</h3>
              {record.timestamps_json ? (
                <VideoWithTimestamps
                  videoSrc={record.file_url}
                  timestamps={parseTimestamps(record.timestamps_json)}
                />
              ) : record.summary_text && record.summary_text.includes('"timestamps"') ? (
                <VideoWithTimestamps
                  videoSrc={record.file_url}
                  timestamps={parseTimestamps(record.summary_text)}
                />
              ) : (
                <div className="text-sm text-slate-500 italic">
                  タイムスタンプはありません
                </div>
              )}
            </div>

            {/* 文字起こし */}
            {record.transcript_text && (
              <div className="rounded-lg bg-white p-6 shadow-md">
                <h2 className="mb-4 text-xl font-semibold text-slate-800">
                  文字起こし
                </h2>
                <div className="max-h-60 overflow-y-auto rounded-md bg-slate-50 p-4 text-sm text-slate-700">
                  {record.transcript_text.substring(0, 500)}...
                </div>
                <button
                  onClick={() => openModal("文字起こし 全文", record.transcript_text)}
                  className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  全文を表示
                </button>
              </div>
            )}

            {/* 要約 */}
            {record.summary_text && (
              <div className="rounded-lg bg-white p-6 shadow-md">
                <h2 className="mb-4 text-xl font-semibold text-slate-800">
                  要約
                </h2>
                <div className="max-h-60 overflow-y-auto rounded-md bg-slate-50 p-4 text-sm text-slate-700">
                  {record.summary_text.substring(0, 500)}...
                </div>
                <button
                  onClick={() => openModal("要約 全文", record.summary_text)}
                  className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  全文を表示
                </button>
              </div>
            )}

            {/* 記事 */}
            {record.article_text && (
              <div className="rounded-lg bg-white p-6 shadow-md">
                <h2 className="mb-4 text-xl font-semibold text-slate-800">
                  生成された記事
                </h2>
                <div className="max-h-60 overflow-y-auto rounded-md bg-slate-50 p-4 text-sm text-slate-700">
                  {record.article_text.substring(0, 500)}...
                </div>
                <button
                  onClick={() => openModal("記事 全文", record.article_text)}
                  className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  全文を表示
                </button>
              </div>
            )}
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
