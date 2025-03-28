"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();

  // 管理者かどうかチェック
  const isAdmin = () => {
    if (!session || !session.user || !session.user.email) {
      return false;
    }
    
    // 特定のメールアドレスを管理者として認識
    const adminEmails = ['ikeike55momo@gmail.com'];
    return adminEmails.includes(session.user.email);
  };

  // ローディング中
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

  // 未認証の場合はログインページにリダイレクト
  if (status === "unauthenticated") {
    router.push("/login");
    return null;
  }

  // 管理者でない場合はアクセス拒否
  if (!isAdmin()) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-600">アクセス拒否</h2>
          <p>この機能にアクセスする権限がありません</p>
          <button
            onClick={() => router.push("/")}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            ホームに戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">管理者ページ</h1>
            <nav className="flex space-x-4">
              <a href="/admin" className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-200">
                ダッシュボード
              </a>
              <a href="/admin/db" className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-200">
                データベース
              </a>
              <a href="/" className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-200">
                アプリに戻る
              </a>
            </nav>
          </div>
        </div>
      </header>
      <main>
        <div className="mx-auto max-w-7xl py-6 sm:px-6 lg:px-8">
          <Suspense fallback={<div>読み込み中...</div>}>
            {children}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
