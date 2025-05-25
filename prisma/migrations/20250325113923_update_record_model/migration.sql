-- CreateEnum
CREATE TYPE "Status" AS ENUM ('UPLOADED', 'PROCESSING', 'COMPLETED', 'ERROR');

-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'ERROR');

-- CreateEnum
CREATE TYPE "ProcessingStep" AS ENUM ('TRANSCRIPTION', 'SUMMARY', 'ARTICLE');

-- CreateTable
CREATE TABLE "records" (
    "id" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "r2_bucket" TEXT,
    "transcription" TEXT,
    "transcriptionStatus" "ProcessStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "summaryStatus" "ProcessStatus" NOT NULL DEFAULT 'PENDING',
    "article" TEXT,
    "articleStatus" "ProcessStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "status" "Status" NOT NULL DEFAULT 'UPLOADED',
    "processing_step" "ProcessingStep",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "records_status_idx" ON "records"("status");
