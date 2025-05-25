import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

/**
 * エラーハンドリングミドルウェア
 * アプリケーション全体でのエラー処理を一元化する
 */
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // エラーの詳細をログに記録
  console.error('エラーが発生しました:', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  // Prismaのエラーを特定して適切に処理
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // データベーススキーマに関連するエラー
    if (err.code === 'P2003' || err.code === 'P2010') {
      console.error('データベーススキーマエラー:', {
        code: err.code,
        message: err.message,
        meta: err.meta
      });
      
      return res.status(500).json({
        error: 'データベースエラー',
        message: 'データベーススキーマに問題があります',
        details: process.env.NODE_ENV === 'production' ? undefined : err.message
      });
    }
    
    // レコードが見つからないエラー
    if (err.code === 'P2001' || err.code === 'P2018') {
      return res.status(404).json({
        error: 'リソースが見つかりません',
        details: process.env.NODE_ENV === 'production' ? undefined : err.message
      });
    }
    
    // 一意制約違反
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: '重複データエラー',
        details: process.env.NODE_ENV === 'production' ? undefined : err.message
      });
    }
  }
  
  // Prismaのバリデーションエラー
  if (err instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json({
      error: 'バリデーションエラー',
      details: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }
  
  // その他のエラー
  const statusCode = err.statusCode || 500;
  const errorMessage = err.message || '内部サーバーエラー';
  
  res.status(statusCode).json({
    error: errorMessage,
    details: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
};
