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
  const [processingStep, setProcessingStep] = useState<number | null>(null);
  const [processingMessage, setProcessingMessage] = useState<string>("");
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
      console.log("タイムスタンプデータ:", timestampsJson);
      const data = JSON.parse(timestampsJson);
      console.log("解析後のデータ:", data);
      return data.timestamps || [];
    } catch (error) {
      console.error("タイムスタンプの解析エラー:", error);
      // エラー時は文字列をそのまま表示して確認
      console.log("解析に失敗したデータ:", timestampsJson);
      return [];
    }
  };

  // 特定のステップから処理を再開する
  const retryFromStep = async (step: number) => {
    if (!recordId) return;
    
    try {
      setProcessingStep(step);
      setProcessingMessage(`ステップ${step}から処理を再開しています...`);
      
      // ステップ名を取得
      const stepNames = ["アップロード", "文字起こし", "タイムスタンプ", "要約", "記事生成"];
      const stepName = stepNames[step - 1] || `ステップ${step}`;
      
      // APIを呼び出して処理を再開
      const response = await fetch(`/api/records/${recordId}/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ step }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `${stepName}の再開に失敗しました`);
      }
      
      // 成功したらレコードを再取得
      const data = await response.json();
      setRecord(data.record);
      setProcessingMessage(`${stepName}の再開が完了しました。処理が開始されました。`);
      
      // 3秒後にメッセージをクリア
      setTimeout(() => {
        setProcessingStep(null);
        setProcessingMessage("");
      }, 3000);
      
    } catch (err) {
      console.error("再開処理エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "処理の再開中にエラーが発生しました"
      );
      setProcessingStep(null);
      setProcessingMessage("");
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
          <div className="flex space-x-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-md bg-gray-600 px-4 py-2 text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              ダッシュボードへ
            </button>
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
            <div className="mt-4 flex justify-center space-x-4">
              <button
                onClick={() => router.push("/results")}
                className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                一覧に戻る
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="rounded-md bg-gray-600 px-4 py-2 text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                ダッシュボードへ
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 処理中メッセージ */}
            {processingStep !== null && (
              <div className="rounded-lg bg-blue-50 p-4 text-blue-700 shadow-md">
                <p>{processingMessage}</p>
              </div>
            )}
            
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
                onRetryStep={retryFromStep}
              />
            </div>

            {/* 動画プレーヤーとタイムスタンプ */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-slate-800 mb-2">タイムスタンプ</h3>
              <div className="mb-2 text-xs text-slate-500">
                <p>timestamps_json: {record.timestamps_json ? "あり" : "なし"}</p>
                <p>summary_text: {record.summary_text ? (record.summary_text.includes('"timestamps"') ? "タイムスタンプあり" : "タイムスタンプなし") : "なし"}</p>
                <p>データ内容: {record.summary_text ? record.summary_text.substring(0, 100) + "..." : "なし"}</p>
              </div>
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
                <div>
                  <div className="text-sm text-slate-500 italic mb-4">
                    タイムスタンプはありません
                  </div>
                  {/* 強制的にタイムスタンプを表示するためのフォールバック */}
                  {record.summary_text && (
                    <div className="mt-4">
                      <h4 className="text-md font-medium text-slate-700 mb-2">タイムスタンプ生成を試みる</h4>
                      <button
                        onClick={() => {
                          try {
                            // サンプルタイムスタンプを生成
                            const sampleData = {
                              timestamps: [
                                { time: 0, text: "動画開始" },
                                { time: 30, text: "主要ポイント1" },
                                { time: 60, text: "主要ポイント2" }
                              ]
                            };
                            console.log("サンプルタイムスタンプ:", sampleData);
                            
                            // 実際のデータがあれば解析を試みる
                            if (record.summary_text) {
                              try {
                                const parsed = JSON.parse(record.summary_text);
                                console.log("summary_textから解析:", parsed);
                                if (parsed.timestamps) {
                                  console.log("タイムスタンプ発見:", parsed.timestamps);
                                }
                              } catch (e) {
                                console.error("summary_textの解析エラー:", e);
                              }
                            }
                          } catch (error) {
                            console.error("タイムスタンプ生成エラー:", error);
                          }
                        }}
                        className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        タイムスタンプ解析を試みる
                      </button>
                    </div>
                  )}
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
