"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

export default function HomePage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100">
      <div className="w-full max-w-4xl rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-6 text-center text-3xl font-bold text-slate-800">
          動画処理アプリケーション
        </h1>
        
        <p className="mb-8 text-center text-lg text-slate-600">
          大規模教育・セミナービデオの処理と変換を行うアプリケーションへようこそ。
          ログインして、動画のアップロード、文字起こし、要約、記事生成を始めましょう。
        </p>
        
        <div className="flex justify-center">
          <Link
            href="/login"
            className="rounded-md bg-blue-600 px-6 py-3 text-lg font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            ログインする
          </Link>
        </div>
      </div>
    </div>
  );
}
