# Cloud Run Gen2実装の問題修正レポート

## 発生していた問題

1. フロントエンドからのリクエストエラー:
   - `net::ERR_INTERNET_DISCONNECTED`
   - `データ取得エラー: TypeError: Failed to fetch`
   - `非同期応答のメッセージチャネルクローズエラー`

2. Cloud Runログに見られるエラー:
   - `POST 502`エラー（Bad Gateway）
   - 特に`transcription-worker`サービスでの問題

## 原因分析

1. **CORS設定の問題**:
   - Cloud Run Gen2ではCORSの動作が従来と異なり、明示的な設定が必要
   - 各ワーカーサービスでCORS設定が不足していた

2. **サービス間のIAM権限問題**:
   - Gen2では権限モデルが厳格化され、明示的なIAM設定が必要
   - サービス間呼び出しの権限が不足していた

3. **リソース制限とタイムアウト問題**:
   - 処理タイムアウトが短すぎる
   - インスタンス数やリソース割り当てが不適切

## 修正内容

### 1. CORS設定の追加

すべてのサービスに下記のCORS設定を追加しました:

```javascript
app.use(cors({
  origin: ['https://vpa.ririaru-stg.cloud'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
```

### 2. IAM権限設定スクリプト

以下のスクリプトを作成し、サービス間の権限を設定できるようにしました:

- `update-cloud-run-iam.sh` - 各サービス間の呼び出し権限設定

### 3. サービス設定最適化スクリプト

サービスごとに最適なリソース設定を適用するスクリプトを作成しました:

- `update-cloud-run-services.sh` - メモリ・CPU・タイムアウト・同時実行数設定

## 適用手順

1. **CORS設定の反映**:
   - すでに各サービスのソースコードを更新済み
   - デプロイ時に自動的に反映されます

2. **IAM権限の設定**:
   ```bash
   chmod +x update-cloud-run-iam.sh
   ./update-cloud-run-iam.sh
   ```

3. **サービス設定の最適化**:
   ```bash
   chmod +x update-cloud-run-services.sh
   ./update-cloud-run-services.sh
   ```

## 追加の推奨事項

1. **エラーハンドリングの強化**:
   - フロントエンドの再試行ロジックの実装検討
   - エラー状態の詳細なログ収集

2. **モニタリングの強化**:
   - Cloud Monitoringでのアラート設定
   - 定期的なヘルスチェックの実装

3. **定期的なメンテナンス**:
   - リソース使用状況の監視と調整
   - エラー発生時の迅速な対応フロー確立

これらの修正により、Cloud Run Gen2環境での動画処理パイプラインの安定性と信頼性が向上します。
