import { PrismaClient, Record, Status } from '@prisma/client';

// PrismaClientのインポート
// 注意: このファイルが存在しない場合は作成する必要があります
const prisma = new PrismaClient();

/**
 * Recordモデルに関するデータアクセス操作を集約したリポジトリ
 */
export const RecordRepository = {
  /**
   * 新しいレコードを作成する
   * @param data 作成するレコードのデータ
   * @returns 作成されたレコード
   */
  async create(data: {
    file_url: string;
    file_key?: string;
    r2_bucket?: string;
  }): Promise<Record> {
    return prisma.record.create({
      data: {
        file_url: data.file_url,
        file_key: data.file_key,
        r2_bucket: data.r2_bucket,
        status: Status.UPLOADED,
      },
    });
  },

  /**
   * IDによってレコードを検索する
   * @param id レコードID
   * @returns 見つかったレコード、または null
   */
  async findById(id: string): Promise<Record | null> {
    return prisma.record.findUnique({
      where: { id },
    });
  },

  /**
   * 全てのレコードを取得する
   * @param limit 取得する最大件数
   * @param offset オフセット（ページネーション用）
   * @returns レコードの配列
   */
  async findAll(limit: number = 10, offset: number = 0): Promise<Record[]> {
    return prisma.record.findMany({
      take: limit,
      skip: offset,
      orderBy: {
        created_at: 'desc',
      },
      where: {
        deleted_at: null,
      },
    });
  },

  /**
   * レコードの総数を取得する
   * @returns レコードの総数
   */
  async count(): Promise<number> {
    return prisma.record.count({
      where: {
        deleted_at: null,
      },
    });
  },

  /**
   * 条件に基づいてレコードを検索する
   * @param options 検索オプション
   * @returns レコードの配列
   */
  async findMany(options: {
    skip?: number;
    take?: number;
    orderBy?: any;
    where?: any;
  }): Promise<Record[]> {
    return prisma.record.findMany({
      skip: options.skip,
      take: options.take,
      orderBy: options.orderBy || { created_at: 'desc' },
      where: options.where || { deleted_at: null },
    });
  },

  /**
   * レコードを更新する
   * @param id 更新するレコードのID
   * @param data 更新データ
   * @returns 更新されたレコード
   */
  async update(id: string, data: Partial<Record>): Promise<Record> {
    return prisma.record.update({
      where: { id },
      data,
    });
  },

  /**
   * レコードのステータスを更新する
   * @param id 更新するレコードのID
   * @param status 新しいステータス
   * @param processingStep 現在の処理ステップ（オプション）
   * @returns 更新されたレコード
   */
  async updateStatus(
    id: string, 
    status: Status, 
    processingStep?: string
  ): Promise<Record> {
    return prisma.record.update({
      where: { id },
      data: {
        status,
        processing_step: processingStep,
      },
    });
  },

  /**
   * エラー情報を記録する
   * @param id 更新するレコードのID
   * @param errorMessage エラーメッセージ
   * @returns 更新されたレコード
   */
  async recordError(id: string, errorMessage: string): Promise<Record> {
    return prisma.record.update({
      where: { id },
      data: {
        status: Status.ERROR,
        error: errorMessage,
      },
    });
  },

  /**
   * 論理削除を行う
   * @param id 削除するレコードのID
   * @returns 削除されたレコード
   */
  async softDelete(id: string): Promise<Record> {
    return prisma.record.update({
      where: { id },
      data: {
        deleted_at: new Date(),
      },
    });
  },

  /**
   * トランスクリプションデータを保存する
   * @param id レコードID
   * @param transcriptText トランスクリプションテキスト
   * @param timestampsJson タイムスタンプデータ（JSON文字列）
   * @returns 更新されたレコード
   */
  async saveTranscription(
    id: string,
    transcriptText: string,
    timestampsJson?: string
  ): Promise<Record> {
    return prisma.record.update({
      where: { id },
      data: {
        transcript_text: transcriptText,
        timestamps_json: timestampsJson,
        status: Status.TRANSCRIBED,
      },
    });
  },

  /**
   * 要約データを保存する
   * @param id レコードID
   * @param summaryText 要約テキスト
   * @returns 更新されたレコード
   */
  async saveSummary(id: string, summaryText: string): Promise<Record> {
    return prisma.record.update({
      where: { id },
      data: {
        summary_text: summaryText,
        status: Status.SUMMARIZED,
      },
    });
  },

  /**
   * 記事データを保存する
   * @param id レコードID
   * @param articleText 記事テキスト
   * @returns 更新されたレコード
   */
  async saveArticle(id: string, articleText: string): Promise<Record> {
    return prisma.record.update({
      where: { id },
      data: {
        article_text: articleText,
        status: Status.DONE,
      },
    });
  },
};
