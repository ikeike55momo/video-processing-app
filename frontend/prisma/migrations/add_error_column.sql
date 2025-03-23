-- Add error column to records table
ALTER TABLE records ADD COLUMN IF NOT EXISTS error TEXT;
