"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function AdminDbPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalContent, setModalContent] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");
  const [schemaInfo, setSchemaInfo] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<string>("records");

  // レコード一覧を取得
  useEffect(() => {
    const fetchRecords = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/admin/db");
        
        if (!response.ok) {
          throw new Error("データベース情報の取得に失敗しました");
        }
        
        const data = await response.json();
        setRecords(data.records || []);
      } catch (error) {
        setError(error instanceof Error ? error.message : "不明なエラーが発生しました");
      } finally {
        setLoading(false);
      }
    };

    const fetchSchema = async () => {
      try {
        const response = await fetch("/api/admin/db/schema");
        
        if (!response.ok) {
          throw new Error("スキーマ情報の取得に失敗しました");
        }
        
        const data = await response.json();
        setSchemaInfo(data.schema || []);
      } catch (error) {
        console.error("スキーマ取得エラー:", error);
      }
    };

    if (status === "authenticated") {
      fetchRecords();
      fetchSchema();
    }
  }, [status]);

  // レコードの詳細を表示
  const viewRecordDetails = (record: any) => {
    setSelectedRecord(record);
    setModalTitle(`レコード詳細: ${record.id}`);
    setModalContent(JSON.stringify(record, null, 2));
    setShowModal(true);
  };

  // タイムスタンプの内容を表示
  const viewTimestamps = (record: any) => {
    if (!record.timestamps_json) {
      setModalTitle("タイムスタンプなし");
      setModalContent("このレコードにはタイムスタンプが保存されていません。");
      setShowModal(true);
      return;
    }

    try {
      const timestamps = JSON.parse(record.timestamps_json);
      setModalTitle(`タイムスタンプ: ${record.id}`);
      setModalContent(JSON.stringify(timestamps, null, 2));
      setShowModal(true);
    } catch (error) {
      setModalTitle("タイムスタンプ解析エラー");
      setModalContent(`タイムスタンプの解析に失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}\n\n生データ:\n${record.timestamps_json}`);
      setShowModal(true);
    }
  };

  // サマリーテキストの内容を表示
  const viewSummaryText = (record: any) => {
    if (!record.summary_text) {
      setModalTitle("サマリーなし");
      setModalContent("このレコードにはサマリーテキストが保存されていません。");
      setShowModal(true);
      return;
    }

    // サマリーテキストにタイムスタンプが含まれているか確認
    const hasTimestamps = record.summary_text.includes('"timestamps"');
    
    if (hasTimestamps) {
      try {
        const data = JSON.parse(record.summary_text);
        setModalTitle(`サマリーテキスト（タイムスタンプ含む）: ${record.id}`);
        setModalContent(JSON.stringify(data, null, 2));
      } catch (error) {
        setModalTitle(`サマリーテキスト: ${record.id}`);
        setModalContent(record.summary_text);
      }
    } else {
      setModalTitle(`サマリーテキスト: ${record.id}`);
      setModalContent(record.summary_text);
    }
    
    setShowModal(true);
  };

  // モーダルを閉じる
  const closeModal = () => {
    setShowModal(false);
    setSelectedRecord(null);
    setModalContent("");
    setModalTitle("");
  };

  // タブを切り替える
  const switchTab = (tab: string) => {
    setActiveTab(tab);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h1 className="text-2xl font-bold mb-6">データベース管理</h1>
      
      {/* タブメニュー */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => switchTab("records")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "records"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            レコード一覧
          </button>
          <button
            onClick={() => switchTab("schema")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "schema"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            スキーマ情報
          </button>
        </nav>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 p-4 rounded-md text-red-700">
          {error}
        </div>
      )}

      {/* レコード一覧タブ */}
      {activeTab === "records" && (
        <div>
          <h2 className="text-xl font-semibold mb-4">レコード一覧</h2>
          
          {loading ? (
            <div className="text-center py-8">
              <p>データを読み込んでいます...</p>
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <p>レコードが見つかりませんでした</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ステータス
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      作成日時
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      タイムスタンプ
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      アクション
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {records.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {record.id.substring(0, 8)}...
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            record.status === "DONE"
                              ? "bg-green-100 text-green-800"
                              : record.status === "ERROR"
                              ? "bg-red-100 text-red-800"
                              : record.status === "PROCESSING"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {record.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(record.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {record.timestamps_json ? (
                          <span className="text-green-600">あり</span>
                        ) : record.summary_text && record.summary_text.includes('"timestamps"') ? (
                          <span className="text-blue-600">サマリーに含まれる</span>
                        ) : (
                          <span className="text-red-600">なし</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => viewRecordDetails(record)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            詳細
                          </button>
                          <button
                            onClick={() => viewTimestamps(record)}
                            className="text-green-600 hover:text-green-900"
                          >
                            タイムスタンプ
                          </button>
                          <button
                            onClick={() => viewSummaryText(record)}
                            className="text-purple-600 hover:text-purple-900"
                          >
                            サマリー
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* スキーマ情報タブ */}
      {activeTab === "schema" && (
        <div>
          <h2 className="text-xl font-semibold mb-4">スキーマ情報</h2>
          
          {schemaInfo.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <p>スキーマ情報が取得できませんでした</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      テーブル名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      カラム名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      データ型
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      NULL許可
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {schemaInfo.map((column, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {column.table_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {column.column_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {column.data_type}
                        {column.character_maximum_length && ` (${column.character_maximum_length})`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {column.is_nullable === "YES" ? "YES" : "NO"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* モーダル */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-medium">{modalTitle}</h3>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-500"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 overflow-auto flex-1">
              <pre className="text-sm bg-gray-50 p-4 rounded-md overflow-x-auto">
                {modalContent}
              </pre>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={closeModal}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
