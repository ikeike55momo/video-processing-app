"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Status, Record } from '@prisma/client'; // Status と Record をインポート
import ProgressIndicator from "../../components/ProgressIndicator";
import ContentModal from "../../components/ContentModal";
import VideoWithTimestamps from "../../components/VideoWithTimestamps";

export const dynamic = 'force-dynamic'; // 動的レンダリングを強制

export default function RecordDetailPage() {
  const { data: session, status: sessionStatus } = useSession(); // status 変数名を変更
  const router = useRouter();
  const params = useParams();
  const recordId = params?.id as string;

  const [record, setRecord] = useState<Record | null>(null); // Record 型を使用
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processingStep, setProcessingStep] = useState<number | null>(null); // UIフィードバック用
  const [processingMessage, setProcessingMessage] = useState<string>(""); // UIフィードバック用
  // モーダル表示用の状態
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState<string | null>(null);

  // セッションチェック
  if (sessionStatus === "loading") { // 変数名を sessionStatus に修正
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">読み込み中...</h2>
          <p>ユーザー情報を確認しています</p>
        </div>
      </div>
    );
  }

  if (sessionStatus === "unauthenticated") { // 変数名を sessionStatus に修正
    router.push("/login");
    return null; // ここで return する
  }

  // レコード情報の取得とポーリング
  useEffect(() => {
    let pollingInterval: NodeJS.Timeout | null = null;

    const fetchRecord = async () => {
      if (!recordId) return; // recordId がなければ何もしない

      try {
        // setLoading(true); // ポーリング中はローディング表示しない
        const response = await fetch(`/api/records/${recordId}`); // /status なしでレコード全体を取得

        if (!response.ok) {
          if (response.status === 404) {
            setError("指定されたレコードが見つかりません。");
          } else {
            throw new Error(`レコード情報の取得に失敗しました (${response.status})`);
          }
          setRecord(null); // エラー時はレコード情報をクリア
          if (pollingInterval) clearTimeout(pollingInterval); // エラー時はポーリング停止 (setTimeoutなのでclearTimeout)
          return; // fetchRecord を終了
        }

    const data = await response.json();
    // APIレスポンス形式の両方に対応
    setRecord(data.record || data);

    // 処理が完了またはエラーでなければポーリング継続
    const recordStatus = data.record?.status || data.status;
    if (recordStatus !== Status.DONE && recordStatus !== Status.ERROR) {
      // 既存のインターバルがあればクリア
      if (pollingInterval) clearTimeout(pollingInterval); // setTimeoutなのでclearTimeout
      // 新しいインターバルを設定
      pollingInterval = setTimeout(fetchRecord, 2000); // 2秒後に再実行
    } else {
      // 完了またはエラーならポーリング停止
      if (pollingInterval) clearTimeout(pollingInterval); // setTimeoutなのでclearTimeout
    }

      } catch (err) {
        console.error("データ取得エラー:", err);
        setError(
          err instanceof Error
            ? err.message
            : "データの取得中にエラーが発生しました"
        );
        if (pollingInterval) clearTimeout(pollingInterval); // エラー時はポーリング停止 (setTimeoutなのでclearTimeout)
      } finally {
        setLoading(false); // 初回またはエラー後のローディング完了
      }
    };

    fetchRecord(); // 初回実行

    // クリーンアップ関数
    return () => {
      if (pollingInterval) {
        clearTimeout(pollingInterval); // setTimeout を使用しているので clearTimeout
      }
    };
  }, [recordId]); // recordId が変更されたら再実行

  // 処理ステップの計算 (ステータスベース、Status enum を使用)
  const calculateStep = (record: Record | null) => {
    if (!record) return 1;

    // APIレスポンス形式の両方に対応
    const status = record.status;
    if (!status) {
      console.warn("Unknown record status:", record.status);
      return 1;
    }

    switch (status) {
      case Status.ERROR:
        // エラー発生前の状態に基づいて返す
        if (record.article_text) return 4;
        if (record.summary_text) return 3;
        if (record.transcript_text) return 1; // 文字起こしは完了していたと仮定
        return 1;
      case Status.DONE:
        return 5;
      case Status.SUMMARIZED:
        return 4;
      case Status.TRANSCRIBED:
        return 3;
      case Status.PROCESSING:
        // processing_progress を見てより正確に判断
        if (record.processing_progress && record.processing_progress >= 80) return 3; // 保存中以降
        if (record.processing_progress && record.processing_progress >= 10) return 2; // 音声処理中
        return 1; // ダウンロード中など
      case Status.UPLOADED:
        return 1;
      default:
        console.warn("Unknown record status:", record.status);
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

  // タイムスタンプの解析
  const parseTimestamps = (record: Record | null): { time: number; text: string }[] => {
    if (!record) return [];

    // APIレスポンス形式の両方に対応
    const timestampsJson = record.timestamps_json;
    
    // 1. timestamps_json を優先
    if (timestampsJson) {
      try {
        const data = JSON.parse(timestampsJson);
        if (Array.isArray(data?.timestamps)) {
          console.log("Parsed timestamps from timestamps_json");
          return data.timestamps;
        }
        // timestamps_json が直接配列の場合
        if (Array.isArray(data)) {
          console.log("Parsed timestamps array directly from timestamps_json");
          return data;
        }
      } catch (error) {
        console.error("Error parsing timestamps_json:", error);
      }
    }

    // 2. summary_text に含まれるかチェック (フォールバック)
    const summaryText = record.summary_text;
    if (summaryText && summaryText.includes('"timestamps"')) {
      try {
        // summary_text 全体がJSON形式であると仮定して解析
        const data = JSON.parse(summaryText);
        if (Array.isArray(data?.timestamps)) {
          console.warn("Parsed timestamps from summary_text (fallback)");
          return data.timestamps;
        }
        // summary_text 内にJSON文字列が含まれる場合の抽出ロジック
        const timestampMatch = summaryText.match(/\{[\s\S]*?"timestamps"\s*:\s*(\[[\s\S]*?\])[\s\S]*?\}/);
        if (timestampMatch && timestampMatch[1]) {
          try {
            const extractedTimestamps = JSON.parse(timestampMatch[1]);
            if (Array.isArray(extractedTimestamps)) {
              console.warn("Extracted timestamps from summary_text JSON substring");
              return extractedTimestamps;
            }
          } catch (e) {
            console.error("Error parsing extracted timestamps:", e);
          }
        }
      } catch (error) {
        console.error("Error parsing summary_text for timestamps:", error);
        
        // JSON解析に失敗した場合、正規表現で抽出を試みる
        try {
          const timestampMatch = summaryText.match(/\{[\s\S]*?"timestamps"\s*:\s*(\[[\s\S]*?\])[\s\S]*?\}/);
          if (timestampMatch && timestampMatch[1]) {
            const extractedTimestamps = JSON.parse(timestampMatch[1]);
            if (Array.isArray(extractedTimestamps)) {
              console.warn("Extracted timestamps using regex fallback");
              return extractedTimestamps;
            }
          }
        } catch (e) {
          console.error("Error in regex extraction fallback:", e);
        }
      }
    }

    // 3. transcript_text に含まれるかチェック (最終フォールバック)
    const transcriptText = record.transcript_text;
    if (transcriptText && transcriptText.includes('"timestamps"')) {
      try {
        // 正規表現でタイムスタンプ部分を抽出
        const timestampMatch = transcriptText.match(/\{[\s\S]*?"timestamps"\s*:\s*(\[[\s\S]*?\])[\s\S]*?\}/);
        if (timestampMatch && timestampMatch[1]) {
          const extractedTimestamps = JSON.parse(timestampMatch[1]);
          if (Array.isArray(extractedTimestamps)) {
            console.warn("Extracted timestamps from transcript_text");
            return extractedTimestamps;
          }
        }
      } catch (error) {
        console.error("Error extracting timestamps from transcript_text:", error);
      }
    }

    // デバッグ情報
    if (record.status !== 'UPLOADED' && record.status !== 'PROCESSING') {
      console.log("No valid timestamps found. Record data:", {
        hasTimestampsJson: !!timestampsJson,
        hasSummaryText: !!summaryText,
        hasTranscriptText: !!record.transcript_text,
        status: record.status
      });
    }
    
    return [];
  };

  // 特定のステップから処理を再開する
  const retryFromStep = async (step: number) => {
    if (!recordId) return;

    try {
      setProcessingStep(step); // UIフィードバック用
      setProcessingMessage(`ステップ${step}から処理を再開しています...`);
      setError(""); // エラー表示をクリア

      const stepNames = ["アップロード", "文字起こし", "タイムスタンプ", "要約", "記事生成"];
      const stepName = stepNames[step - 1] || `ステップ${step}`;

      const response = await fetch(`/api/records/${recordId}/retry`, { // retry APIを使用
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ step }), // step番号を渡す
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `${stepName}の再開に失敗しました`);
      }

      const data = await response.json();
      setRecord(data.record); // 更新されたレコード情報でステートを更新
      setProcessingMessage(`${stepName}の再開リクエストを受け付けました。処理が開始されます。`);

      // メッセージを少し長く表示
      setTimeout(() => {
        setProcessingStep(null);
        setProcessingMessage("");
      }, 5000);

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

  // handleRetry 関数 (エラーからの再試行)
  const handleRetryError = async () => {
    if (!recordId || !record || record.status !== Status.ERROR) return;

    try {
      setProcessingStep(0); // リトライ中を示す (ステップ0など)
      setProcessingMessage(`エラーが発生した処理を再試行しています...`);
      setError(""); // エラー表示をクリア

      const response = await fetch(`/api/records/${recordId}/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // ステップ指定なしで呼び出す
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `処理の再試行に失敗しました`);
      }

      const data = await response.json();
      setRecord(data.record);
      setProcessingMessage(`再試行リクエストを受け付けました。処理が開始されます。`);

      setTimeout(() => {
        setProcessingStep(null);
        setProcessingMessage("");
      }, 5000);

    } catch (err) {
      console.error("エラー再試行エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "エラーからの再試行中に問題が発生しました"
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
            {processingMessage && ( // processingMessage があれば表示
              <div className="rounded-lg bg-blue-50 p-4 text-blue-700 shadow-md">
                <p>{processingMessage}</p>
              </div>
            )}

            {/* 基本情報 */}
            <div className="rounded-lg bg-white p-6 shadow-md">
              <h2 className="mb-2 text-xl font-semibold text-slate-800">
                {/* ファイル名表示を修正 */}
                {record.file_name || record.file_url?.split("/").pop() || "ファイル名なし"}
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                アップロード日時: {new Date(record.created_at).toLocaleString()}
              </p>

              <ProgressIndicator
                currentStep={calculateStep(record)}
                totalSteps={5}
                status={record.status}
                error={record.error}
                onRetry={handleRetryError} // エラーからの再試行関数を渡す
                onRetryStep={retryFromStep}
              />
            </div>

            {/* 動画プレーヤーとタイムスタンプ */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-slate-800 mb-2">タイムスタンプ</h3>
              {/* デバッグ用情報を削除 */}
              {/* <div className="mb-2 text-xs text-slate-500">...</div> */}
              <VideoWithTimestamps
                  src={record.file_url || ""} // null チェック追加
                  timestamps={parseTimestamps(record)} // record オブジェクトを渡す
              />
              {/* タイムスタンプがない場合の表示 */}
              {parseTimestamps(record).length === 0 && record.status !== Status.UPLOADED && record.status !== Status.PROCESSING && (
                 <div className="text-sm text-slate-500 italic mt-4">
                    タイムスタンプデータが見つかりませんでした。
                  </div>
              )}
            </div>

            {/* 文字起こし (データがあれば常に表示) */}
            <div className="rounded-lg bg-white p-6 shadow-md">
              <h2 className="mb-4 text-xl font-semibold text-slate-800">
                文字起こし
              </h2>
              {record.transcript_text ? (
                <>
                  <div className="max-h-60 overflow-y-auto rounded-md bg-slate-50 p-4 text-sm text-slate-700">
                    {record.transcript_text.substring(0, 500)}...
                  </div>
                  <button
                    onClick={() => openModal("文字起こし 全文", record.transcript_text)}
                    className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    全文を表示
                  </button>
                </>
              ) : (
                <p className="text-sm text-slate-500 italic">
                  {record.status === Status.UPLOADED || record.status === Status.PROCESSING ? "文字起こし処理中です..." : "文字起こしデータはありません。"}
                </p>
              )}
            </div>

            {/* 要約 (データがあれば常に表示) */}
            <div className="rounded-lg bg-white p-6 shadow-md">
              <h2 className="mb-4 text-xl font-semibold text-slate-800">
                要約
              </h2>
              {record.summary_text ? (
                <>
                  <div className="max-h-60 overflow-y-auto rounded-md bg-slate-50 p-4 text-sm text-slate-700">
                    {/* タイムスタンプ情報が含まれている場合は表示しないようにする */}
                    {record.summary_text.includes('"timestamps"')
                      ? "(タイムスタンプ情報を含むため、要約テキストのみを表示する機能は未実装です)" // 仮表示
                      : record.summary_text.substring(0, 500) + "..."}
                  </div>
                  <button
                    onClick={() => openModal("要約 全文", record.summary_text)}
                    className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    全文を表示
                  </button>
                </>
               ) : (
                 <p className="text-sm text-slate-500 italic">
                   {record.status === Status.UPLOADED || record.status === Status.PROCESSING || record.status === Status.TRANSCRIBED ? "要約処理中です..." : "要約データはありません。"}
                 </p>
               )}
            </div>

            {/* 記事 (データがあれば常に表示) */}
            <div className="rounded-lg bg-white p-6 shadow-md">
              <h2 className="mb-4 text-xl font-semibold text-slate-800">
                生成された記事
              </h2>
              {record.article_text ? (
                <>
                  <div className="max-h-60 overflow-y-auto rounded-md bg-slate-50 p-4 text-sm text-slate-700">
                    {record.article_text.substring(0, 500)}...
                  </div>
                  <button
                    onClick={() => openModal("記事 全文", record.article_text)}
                    className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    全文を表示
                  </button>
                </>
              ) : (
                 <p className="text-sm text-slate-500 italic">
                   {record.status !== Status.DONE && record.status !== Status.ERROR ? "記事生成処理中です..." : "記事データはありません。"}
                 </p>
              )}
            </div>
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
