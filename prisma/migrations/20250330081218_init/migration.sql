-- CreateTable
CREATE TABLE "records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "file_url" TEXT,
    "file_key" TEXT,
    "r2_bucket" TEXT,
    "transcript_text" TEXT,
    "timestamps_json" TEXT,
    "summary_text" TEXT,
    "article_text" TEXT,
    "error" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "processing_step" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);
