-- AlterTable
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "file_key" TEXT;
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "r2_bucket" TEXT;
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "processing_step" TEXT;
