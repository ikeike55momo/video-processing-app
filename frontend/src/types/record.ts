export type Status = 'UPLOADED' | 'PROCESSING' | 'DONE' | 'ERROR';

export interface Record {
  id: string;
  file_url: string | null;
  transcript_text: string | null;
  timestamps_json: string | null;
  summary_text: string | null;
  article_text: string | null;
  status: Status;
  error: string | null;
  created_at: Date;
  deleted_at: Date | null;
  processing_progress?: number;
}
