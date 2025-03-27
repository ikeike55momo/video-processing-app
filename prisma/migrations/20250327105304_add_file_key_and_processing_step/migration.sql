/*
  Warnings:

  - The values [COMPLETED] on the enum `Status` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `article` on the `records` table. All the data in the column will be lost.
  - You are about to drop the column `articleStatus` on the `records` table. All the data in the column will be lost.
  - You are about to drop the column `errorMessage` on the `records` table. All the data in the column will be lost.
  - You are about to drop the column `fileUrl` on the `records` table. All the data in the column will be lost.
  - You are about to drop the column `summary` on the `records` table. All the data in the column will be lost.
  - You are about to drop the column `summaryStatus` on the `records` table. All the data in the column will be lost.
  - You are about to drop the column `transcription` on the `records` table. All the data in the column will be lost.
  - You are about to drop the column `transcriptionStatus` on the `records` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `records` table. All the data in the column will be lost.
  - The `processing_step` column on the `records` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `file_url` to the `records` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Status_new" AS ENUM ('UPLOADED', 'PROCESSING', 'TRANSCRIBED', 'SUMMARIZED', 'DONE', 'ERROR');
ALTER TABLE "records" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "records" ALTER COLUMN "status" TYPE "Status_new" USING ("status"::text::"Status_new");
ALTER TYPE "Status" RENAME TO "Status_old";
ALTER TYPE "Status_new" RENAME TO "Status";
DROP TYPE "Status_old";
ALTER TABLE "records" ALTER COLUMN "status" SET DEFAULT 'UPLOADED';
COMMIT;

-- DropIndex
DROP INDEX "records_status_idx";

-- AlterTable
ALTER TABLE "records" DROP COLUMN "article",
DROP COLUMN "articleStatus",
DROP COLUMN "errorMessage",
DROP COLUMN "fileUrl",
DROP COLUMN "summary",
DROP COLUMN "summaryStatus",
DROP COLUMN "transcription",
DROP COLUMN "transcriptionStatus",
DROP COLUMN "updated_at",
ADD COLUMN     "article_text" TEXT,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "file_url" TEXT NOT NULL,
ADD COLUMN     "summary_text" TEXT,
ADD COLUMN     "transcript_text" TEXT,
ALTER COLUMN "file_key" DROP NOT NULL,
DROP COLUMN "processing_step",
ADD COLUMN     "processing_step" TEXT;

-- DropEnum
DROP TYPE "ProcessStatus";

-- DropEnum
DROP TYPE "ProcessingStep";
