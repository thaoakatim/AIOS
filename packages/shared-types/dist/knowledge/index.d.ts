/**
 * Knowledge Module — Shared contracts dùng chung cho API & Web.
 * Tương ứng bảng Prisma `Document`, `DocumentChunk`, `MessageDocument`
 * (apps/api/prisma/schema.prisma).
 *
 * - status: vòng đời tài liệu trong pipeline RAG
 *   ("pending" → "processing" → "indexed" | "failed")
 * - `document_chunks.metadata` là JSONB chứa `chunkIndex`, `startOffset`,
 *   `endOffset`, `totalChunks` — dùng để trích dẫn nguồn trong câu trả lời.
 */
import { DocumentStatus } from '../enums';
export { DocumentStatus };
export interface IDocument {
    id: string;
    title: string;
    /** Định dạng: "pdf" | "md" | "docx" | "txt" | ... */
    fileType: string | null;
    /** Đường dẫn/url file gốc trên Local Storage. */
    sourceUrl: string | null;
    status: string;
    createdAt: Date;
    /** Số chunk đã index. */
    chunkCount?: number;
}
export interface IDocumentChunk {
    id: string;
    documentId: string;
    content: string;
    metadata: Record<string, unknown> | null;
}
/** Một kết quả Semantic Search đã làm giàu thông tin tài liệu. */
export interface IKnowledgeSearchHit {
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
export interface KnowledgeSearchResponse {
    query: string;
    data: IKnowledgeSearchHit[];
    total: number;
    embedding: {
        model: string;
        dimensions: number;
    };
}
export interface KnowledgeListResponse {
    data: IDocument[];
    total: number;
}
/** Body multipart của `POST /knowledge/upload` (field `file`). */
export interface UploadDocumentPayload {
    title?: string;
    fileType?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    /** 'sync' (mặc định) hoặc 'queue' (BullMQ). */
    mode?: 'sync' | 'queue';
    /** Gắn tài liệu vào các Message đã có (bảng MessageDocument). */
    messageIds?: string[];
}
export interface KnowledgeIngestionResult {
    document: IDocument;
    status: string;
    chunkCount: number;
    /** true nếu job được đẩy vào BullMQ thay vì xử lý đồng bộ. */
    queued: boolean;
    error?: string;
}
/** Query của `GET /knowledge/search`. */
export interface KnowledgeSearchQuery {
    query: string;
    /** Top-K (mặc định 5, tối đa 50). */
    limit?: number;
    /** Ngưỡng điểm tương đồng tối thiểu (0..1). */
    minScore?: number;
    /** Chỉ tìm trong một tài liệu cụ thể. */
    documentId?: string;
}
/** Query của `GET /knowledge`. */
export interface KnowledgeFilter {
    status?: string;
    fileType?: string;
    search?: string;
    limit?: number;
    offset?: number;
}
/** Body gắn nhiều tài liệu vào một Message (`MessageDocument`). */
export interface LinkDocumentsPayload {
    documentIds: string[];
}
//# sourceMappingURL=index.d.ts.map