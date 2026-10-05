import { Document, DocumentChunk } from '@prisma/client';

/**
 * Trạng thái vòng đời của tài liệu trong pipeline RAG.
 * Đồng bộ với cột `documents.status` và enum `DocumentStatus` của shared-types.
 */
export const DOCUMENT_STATUSES = [
  'pending',
  'processing',
  'indexed',
  'failed',
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * Entity `Document` — metadata của tài liệu gốc do người dùng upload
 * (bảng `documents`). Là lớp thuần TypeScript bọc Prisma model để tầng
 * Controller không phụ thuộc trực tiếp vào kiểu Prisma (giống `Memory`).
 */
export class KnowledgeDocument {
  id!: string;
  title!: string;
  fileType!: string | null;
  /** Đường dẫn/url file gốc trên Local Storage. */
  sourceUrl!: string | null;
  status!: string;
  createdAt!: Date;
  /** Số chunk đã index — dựng từ `_count.chunks` của Prisma. */
  chunkCount?: number;

  static fromPrisma(
    record: Document & { _count?: { chunks: number } },
  ): KnowledgeDocument {
    const entity = new KnowledgeDocument();
    entity.id = record.id;
    entity.title = record.title;
    entity.fileType = record.fileType;
    entity.sourceUrl = record.sourceUrl;
    entity.status = record.status;
    entity.createdAt = record.createdAt;
    entity.chunkCount = record._count?.chunks;
    return entity;
  }

  static fromPrismaMany(
    records: Array<Document & { _count?: { chunks: number } }>,
  ): KnowledgeDocument[] {
    return records.map((record) => KnowledgeDocument.fromPrisma(record));
  }
}

/** Tên entity thuận tiện cho code đọc tài liệu. */
export { KnowledgeDocument as DocumentEntity };

/**
 * Entity `DocumentChunk` — một đoạn văn bản đã chia nhỏ, nằm trong bảng
 * `document_chunks`.
 *
 * Cột `embedding` là kiểu `Unsupported` (pgvector) nên Prisma không sinh type
 * cho nó — service KHÔNG bao giờ đọc/ghi embedding qua Prisma mà thông qua
 * `IVectorStore`.
 *
 * `chunkIndex` không phải cột vật lý: nó được lưu trong JSONB `metadata`
 * (metadata.chunkIndex) để thứ tự đọc lại ổn định và làm citation.
 */
export class KnowledgeChunk {
  id!: string;
  documentId!: string;
  content!: string;
  metadata!: Record<string, unknown> | null;

  static fromPrisma(record: DocumentChunk): KnowledgeChunk {
    const entity = new KnowledgeChunk();
    entity.id = record.id;
    entity.documentId = record.documentId;
    entity.content = record.content;
    entity.metadata =
      (record.metadata as Record<string, unknown> | null) ?? null;
    return entity;
  }

  static fromPrismaMany(records: DocumentChunk[]): KnowledgeChunk[] {
    return records.map((record) => KnowledgeChunk.fromPrisma(record));
  }

  /** Thứ tự chunk trong tài liệu gốc (0-based), đọc từ `metadata.chunkIndex`. */
  get chunkIndex(): number {
    const raw = this.metadata?.chunkIndex;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  }
}

/** Một kết quả Semantic Search đã làm giàu thông tin tài liệu. */
export interface KnowledgeSearchHit {
  chunkId: string;
  documentId: string;
  /** Tiêu đề tài liệu gốc — dùng để LLM trích dẫn nguồn. */
  documentTitle: string;
  content: string;
  /** Điểm tương đồng cosine (cao hơn = liên quan hơn). */
  score: number;
  chunkIndex: number;
  metadata: Record<string, unknown>;
}

/** Response của `GET /knowledge/search` và `KnowledgeService.search`. */
export interface KnowledgeSearchResult {
  query: string;
  data: KnowledgeSearchHit[];
  total: number;
  /** Model + số chiều vector đã dùng (hỗ trợ debug & tái lập kết quả). */
  embedding: { model: string; dimensions: number };
}

/** Kết quả phân trang danh sách tài liệu (Knowledge Hub). */
export interface KnowledgeListResult {
  data: KnowledgeDocument[];
  total: number;
}

/** Kết quả một lần chạy pipeline ingestion (upload hoặc reindex). */
export interface KnowledgeIngestionResult {
  document: KnowledgeDocument;
  status: DocumentStatus;
  /** Số chunk đã tạo + đã ghi vector. 0 nếu pipeline chưa chạy xong. */
  chunkCount: number;
  /** true nếu job được đẩy vào BullMQ thay vì xử lý đồng bộ. */
  queued: boolean;
  /** Thông báo lỗi khi status = 'failed' (đã lưu vào log để debug). */
  error?: string;
}
