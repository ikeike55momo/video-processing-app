"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

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

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800">ダッシュボード</h1>
          <p className="text-slate-600">
            ようこそ、{session?.user?.name || "ユーザー"}さん
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {/* 管理者ページへのリンク（管理者のみ表示） */}
          {session?.user && 'role' in session.user && session.user.role === "ADMIN" && (
            <div className="rounded-lg bg-white p-6 shadow-md border-l-4 border-purple-500">
              <h2 className="mb-4 text-xl font-semibold text-slate-800">
                管理者機能
              </h2>
              <p className="mb-4 text-slate-600">
                データベース管理や設定変更など、管理者向けの機能にアクセスします。
              </p>
              <button
                className="rounded-md bg-purple-600 px-4 py-2 text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                onClick={() => router.push("/admin/db")}
              >
                データベース管理
              </button>
            </div>
          )}
          <div className="rounded-lg bg-white p-6 shadow-md">
            <h2 className="mb-4 text-xl font-semibold text-slate-800">
              動画アップロード
            </h2>
            <p className="mb-4 text-slate-600">
              大規模な教育・セミナービデオをアップロードして、文字起こし、要約、記事生成を自動的に行います。
            </p>
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              onClick={() => router.push("/upload")}
            >
              アップロードページへ
            </button>
          </div>

          <div className="rounded-lg bg-white p-6 shadow-md">
            <h2 className="mb-4 text-xl font-semibold text-slate-800">
              処理済み動画
            </h2>
            <p className="mb-4 text-slate-600">
              これまでに処理した動画の一覧を表示します。文字起こし、要約、生成された記事を確認できます。
            </p>
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              onClick={() => router.push("/results")}
            >
              結果一覧へ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
