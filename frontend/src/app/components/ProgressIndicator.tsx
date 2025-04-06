"use client";

import { Status } from '@prisma/client'; // Status enum をインポート

export default function ProgressIndicatorComponent({
  currentStep,
  totalSteps,
  status,
  error,
  onRetry,
  onRetryStep, // API未対応のため、呼び出し側で渡さない想定
}: {
  currentStep: number;
  totalSteps: number;
  status: Status; // string から Status 型に変更
  error?: string | null;
  onRetry?: () => void; // エラーからの再試行用
  onRetryStep?: (step: number) => void; // 特定ステップからの再開用 (今回は使用しない)
}) {
  // ステップ定義を修正 (タイムスタンプを削除し、IDを振り直し)
  const steps = [
    { id: 1, name: "アップロード", status: Status.UPLOADED }, // Status enum を直接使用
    { id: 2, name: "文字起こし", status: Status.PROCESSING },
    { id: 3, name: "要約", status: Status.TRANSCRIBED },
    { id: 4, name: "記事生成", status: Status.SUMMARIZED },
    { id: 5, name: "完了", status: Status.DONE },
  ];

  // 現在のDBステータスに対応する表示上のステップ名と状態を取得
  const getCurrentDisplayState = () => {
    switch (status) {
      case Status.UPLOADED: return { name: "アップロード完了", state: "待機中" };
      case Status.PROCESSING: return { name: "文字起こし中", state: "処理中" };
      case Status.TRANSCRIBED: return { name: "要約中", state: "処理中" };
      case Status.SUMMARIZED: return { name: "記事生成中", state: "処理中" };
      case Status.DONE: return { name: "完了", state: "完了" };
      case Status.ERROR: return { name: "エラー", state: "エラー" };
      default: return { name: "不明", state: "待機中" };
    }
  };

  const currentDisplayState = getCurrentDisplayState();

  // ステップごとの状態を決定するロジックを修正
  const getStepDisplayStatus = (stepId: number): "完了" | "処理中" | "エラー" | "待機中" => {
    const step = steps.find(s => s.id === stepId);
    if (!step) return "待機中";

    // エラー時の処理
    if (status === Status.ERROR) {
      // calculateStepの結果（currentStep）はエラー発生前の最後の完了ステップを示している想定
      const errorStep = currentStep + 1; // 仮定
      if (stepId < errorStep) return "完了";
      if (stepId === errorStep) return "エラー";
      return "待機中";
    }

    if (status === Status.DONE) return "完了"; // 全て完了

    // 現在のDBステータスが、そのステップが担当するステータスか？
    if (status === step.status) return "処理中";

    // 現在のDBステータスが、そのステップより後のステップのステータスか？
    const currentStepIndex = steps.findIndex(s => s.status === status);
    const targetStepIndex = steps.findIndex(s => s.id === stepId);

    // ステータスが見つからない場合（defaultケースなど）は待機中
    if (currentStepIndex === -1) return "待機中";

    // 現在のステータスより前のステップは完了
    if (targetStepIndex < currentStepIndex) return "完了";

    // それ以外は待機中
    return "待機中";
  };


  const getStepStatusClass = (stepId: number) => {
    const displayStatus = getStepDisplayStatus(stepId);
    switch (displayStatus) {
      case "完了": return "bg-green-500";
      case "処理中": return "bg-blue-500 animate-pulse";
      case "エラー": return "bg-red-500";
      default: return "bg-gray-300";
    }
  };

  // プログレスバーの計算ロジック修正
  // 完了したステップ数に基づいて計算する
  const calculateProgressPercent = () => {
    if (status === Status.DONE) return 100;
    if (status === Status.ERROR) {
       // エラー発生前の完了ステップに基づいて計算
       // currentStep は calculateStep の結果 (1-5)
       return ((currentStep) / totalSteps) * 100; // currentStepは完了した最後のステップ+1なのでこれでOK
    }
    // 現在処理中のステップの手前まで完了しているとみなす
    const currentProcessingStepIndex = steps.findIndex(s => s.status === status);
    // 完了したステップ数 (0始まりindex)
    const completedSteps = currentProcessingStepIndex >= 0 ? currentProcessingStepIndex : 0;
    return (completedSteps / totalSteps) * 100; // 完了ステップ数で計算
  };

  const progressPercent = calculateProgressPercent();


  return (
    <div className="my-8">
      <h3 className="mb-4 text-lg font-medium text-slate-800">
        処理状況: <span className={`font-semibold ${
          status === Status.ERROR ? 'text-red-600' :
          status === Status.DONE ? 'text-green-600' :
          'text-blue-600'
        }`}>{currentDisplayState.name}</span>
      </h3>

      <div className="mb-6 space-y-4">
        {steps.map((step) => {
          const displayStatus = getStepDisplayStatus(step.id);
          return (
            <div key={step.id} className="flex items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-white ${getStepStatusClass(
                  step.id
                )}`}
              >
                {displayStatus === "完了" ? "✓" : step.id}
              </div>
              <div className="ml-4 flex-1">
                <div className="flex justify-between">
                  <span className="font-medium text-slate-700">{step.name}</span>
                  <div className="flex items-center space-x-2">
                    <span className={`text-sm ${
                      displayStatus === 'エラー' ? 'text-red-600' : 'text-slate-500'
                    }`}>
                      {displayStatus}
                    </span>
                    {/* ステップ指定での再開ボタンはAPI未対応のため表示しない */}
                    {/* {onRetryStep && displayStatus === "待機中" && step.id > 1 && ( ... )} */}
                  </div>
                </div>
                {/* エラー表示は status が ERROR の場合にのみ行う */}
                {status === Status.ERROR && displayStatus === "エラー" && error && (
                  <div className="mt-1">
                    <p className="text-sm text-red-600">{error}</p>
                    {onRetry && ( // エラーからの再試行ボタン
                      <button
                        onClick={onRetry}
                        className="mt-2 rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-200"
                      >
                        再試行
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* プログレスバー */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full transition-all duration-500 ${
            status === Status.ERROR ? "bg-red-500" : "bg-blue-600"
          }`}
          style={{ width: `${progressPercent}%` }} // 修正したパーセントを使用
        ></div>
      </div>

      <div className="mt-2 text-right text-sm text-slate-500">
        {/* バーの%表示ではなく、現在の状態を表示 */}
        {currentDisplayState.name} ({Math.round(progressPercent)}%)
      </div>
    </div>
  );
}
