"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function ProgressIndicatorComponent({
  currentStep,
  totalSteps,
  status,
  error,
  onRetry,
  onRetryStep,
}: {
  currentStep: number;
  totalSteps: number;
  status: string;
  error?: string;
  onRetry?: () => void;
  onRetryStep?: (step: number) => void;
}) {
  const steps = [
    { id: 1, name: "アップロード" },
    { id: 2, name: "文字起こし" },
    { id: 3, name: "タイムスタンプ" },
    { id: 4, name: "要約" },
    { id: 5, name: "記事生成" },
  ];

  const getStepStatus = (stepId: number) => {
    if (stepId < currentStep) return "完了";
    if (stepId === currentStep) {
      if (status === "ERROR") return "エラー";
      return "処理中";
    }
    return "待機中";
  };

  const getStepStatusClass = (stepId: number) => {
    if (stepId < currentStep) return "bg-green-500";
    if (stepId === currentStep) {
      if (status === "ERROR") return "bg-red-500";
      return "bg-blue-500 animate-pulse";
    }
    return "bg-gray-300";
  };

  return (
    <div className="my-8">
      <h3 className="mb-4 text-lg font-medium text-slate-800">処理状況</h3>
      
      <div className="mb-6 space-y-4">
        {steps.map((step) => (
          <div key={step.id} className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-white ${getStepStatusClass(
                step.id
              )}`}
            >
              {step.id < currentStep ? "✓" : step.id}
            </div>
            <div className="ml-4 flex-1">
              <div className="flex justify-between">
                <span className="font-medium text-slate-700">{step.name}</span>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-slate-500">
                    {getStepStatus(step.id)}
                  </span>
                  {onRetryStep && step.id > 1 && (
                    <button
                      onClick={() => onRetryStep(step.id)}
                      className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 hover:bg-blue-200"
                      title={`${step.name}から再開`}
                    >
                      再開
                    </button>
                  )}
                </div>
              </div>
              {step.id === currentStep && status === "ERROR" && error && (
                <div className="mt-1">
                  <p className="text-sm text-red-600">{error}</p>
                  {onRetry && (
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
        ))}
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full bg-blue-600 transition-all duration-500"
          style={{
            width: `${(currentStep / totalSteps) * 100}%`,
            backgroundColor:
              status === "ERROR" ? "rgb(239, 68, 68)" : undefined,
          }}
        ></div>
      </div>
      
      <div className="mt-2 text-right text-sm text-slate-500">
        {Math.round((currentStep / totalSteps) * 100)}% 完了
      </div>
    </div>
  );
}
