-- 処理進捗率を保存するためのカラムを追加
-- 0-100の値で進捗状況を表します（小数点以下も許容）
ALTER TABLE "records" ADD COLUMN "processing_progress" DOUBLE PRECISION;
