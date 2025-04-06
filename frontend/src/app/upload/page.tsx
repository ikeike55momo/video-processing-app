"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { uploadMultipart } from "@/lib/storage"; // Assuming this handles multipart correctly
import JobProgressMonitor from "../components/JobProgressMonitor";
import { Box, Button, CircularProgress, Container, Paper, TextField, Typography, Alert, LinearProgress } from '@mui/material'; // Import MUI components and LinearProgress

export default function UploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [uploadStage, setUploadStage] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null); // Can be BullMQ jobId or recordId
  const [recordId, setRecordId] = useState<string | null>(null); // Store the actual recordId
  const [isJobComplete, setIsJobComplete] = useState(false); // State to track completion

  // Session check effect
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <CircularProgress />
          <h2 className="text-xl font-semibold mt-4">読み込み中...</h2>
          <p>ユーザー情報を確認しています</p>
        </div>
      </div>
    );
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    setError("");
    setFile(null);
    setJobId(null);
    setRecordId(null);
    setUploading(false);
    setUploadProgress(0);
    setUploadStage("");
    setIsJobComplete(false);


    if (!selectedFile) {
      return;
    }

    if (selectedFile.type !== "video/mp4") {
      setError("MP4形式の動画ファイルのみアップロード可能です");
      return;
    }

    const maxSize = 15 * 1024 * 1024 * 1024; // 15GB
    if (selectedFile.size > maxSize) {
      setError("ファイルサイズは15GB以下にしてください");
      return;
    }

    setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) {
      setError("ファイルを選択してください");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStage("署名付きURL取得中...");
    setError("");
    setJobId(null);
    setRecordId(null);
    setIsJobComplete(false);


    try {
      // 1. Get Upload URL and Record ID
      const uploadUrlResponse = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      });

      if (!uploadUrlResponse.ok) {
        throw new Error(`署名付きURLの取得に失敗しました: ${uploadUrlResponse.statusText}`);
      }

      const uploadUrlResult = await uploadUrlResponse.json();
      const { uploadUrl, recordId: generatedRecordId, fileKey, fileUrl: publicFileUrl } = uploadUrlResult;

      if (!uploadUrl || !generatedRecordId || !fileKey) {
         throw new Error("サーバーから必要なアップロード情報が返されませんでした。");
      }

      setRecordId(generatedRecordId); // Store the generated record ID

      // 2. Upload File
      setUploadStage("アップロード中...");
      await uploadFileWithProgress(file, uploadUrl); // Use standard PUT upload
      console.log("アップロード成功");

      // 3. Start Processing
      setUploadStage("処理を開始中...");
      const processResponse = await fetch(`/api/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: generatedRecordId,
          fileKey: fileKey,
          fileUrl: publicFileUrl,
        }),
      });

      if (!processResponse.ok) {
        const errorData = await processResponse.json();
        console.error("処理開始APIエラー:", errorData);
        throw new Error(`処理の開始に失敗しました: ${errorData.error || processResponse.statusText}`);
      }

      const processResult = await processResponse.json();
      const returnedJobId = processResult.jobId;

      if (!returnedJobId) {
          console.warn("バックエンドAPIからジョブIDが返されませんでした。レコードIDで監視します。");
          setJobId(generatedRecordId);
      } else {
          console.log(`処理開始API成功: jobId=${returnedJobId}`);
          setJobId(returnedJobId);
      }

      setUploadStage("処理中...");

    } catch (err) {
      console.error("アップロードまたは処理開始エラー:", err);
      setError(err instanceof Error ? err.message : "アップロードまたは処理開始中にエラーが発生しました");
      setUploading(false);
      setJobId(null);
      setRecordId(null);
    }
  };

  const uploadFileWithProgress = (file: File, signedUrl: string) => {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signedUrl, true);
      xhr.setRequestHeader("Content-Type", file.type);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`アップロード失敗: ${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("アップロード中にネットワークエラーが発生しました"));
      xhr.onabort = () => reject(new Error("アップロードが中断されました"));
      xhr.ontimeout = () => reject(new Error("アップロードがタイムアウトしました"));
      xhr.timeout = 14400000; // 4 hours
      xhr.send(file);
    });
  };

  const handleProcessingComplete = (result: any) => {
    console.log("Processing complete callback triggered", result);
    // setIsJobComplete(true); // Let JobProgressMonitor handle redirect
  };

  const handleProcessingError = (error: any) => {
    console.error("Processing error callback triggered", error);
    setError(`処理中にエラーが発生しました: ${error}`);
    setUploading(false);
  };


  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom align="center">
          動画アップロード
        </Typography>
        <Typography variant="body1" color="text.secondary" align="center" gutterBottom>
          MP4形式の動画ファイル（最大15GB）をアップロードしてください
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 3 }}>
          <Button
            variant="contained"
            component="label"
            disabled={uploading}
            fullWidth
          >
            ファイルを選択
            <input
              type="file"
              hidden
              accept="video/mp4"
              onChange={handleFileChange}
              disabled={uploading}
            />
          </Button>
          {file && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              選択中: {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
            </Typography>
          )}
        </Box>

        {uploading && !jobId && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body1" gutterBottom>{uploadStage}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Box sx={{ width: '100%', mr: 1 }}>
                <LinearProgress variant="determinate" value={uploadProgress} />
              </Box>
              <Box sx={{ minWidth: 35 }}>
                <Typography variant="body2" color="text.secondary">{`${Math.round(uploadProgress)}%`}</Typography>
              </Box>
            </Box>
          </Box>
        )}

        {/* Render JobProgressMonitor only when jobId and recordId are set */}
        {jobId && recordId && (
           <JobProgressMonitor
              jobId={jobId}
              recordIdProp={recordId} // ★★★ Pass recordId to recordIdProp ★★★
              onComplete={handleProcessingComplete}
              onError={handleProcessingError}
            />
        )}

        <Button
          variant="contained"
          color="primary"
          onClick={handleUpload}
          disabled={!file || uploading}
          fullWidth
          sx={{ mt: 2 }}
        >
          {uploading ? "処理中..." : "アップロードして処理を開始"}
        </Button>

         <Button
            variant="outlined"
            onClick={() => router.push("/results")}
            fullWidth
            sx={{ mt: 2 }}
          >
            処理済み動画を表示
          </Button>

      </Paper>
    </Container>
  );
}
