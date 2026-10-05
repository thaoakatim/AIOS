/**
 * Hợp đồng Embedding (Anti-Corruption Layer cho tầng Core).
 *
 * Core KHÔNG phụ thuộc SDK của nhà cung cấp (OpenAI / Gemini / Ollama) —
 * adapter ở `infrastructure/embedding` mới là chỗ duy nhất được phép import SDK.
 * Toàn bộ RAG pipeline của Knowledge Module chỉ làm việc với `IEmbeddingClient`.
 *
 * Chiều vector mặc định của AIOS là 768 (khớp cột `embedding vector(768)`
 * trong bảng `document_chunks` — xem apps/api/prisma/schema.prisma).
 */
export interface EmbeddingUsage {
  promptTokens: number;
  totalTokens: number;
}

export interface EmbedBatchResult {
  /** Các vector theo đúng thứ tự đầu vào. */
  vectors: number[][];
  usage: EmbeddingUsage;
  model: string;
}

/**
 * Client sinh vector nhúng. Hợp đồng bắt buộc:
 * - `embed()` phải giữ nguyên thứ tự vector theo thứ tự `texts` đầu vào
 *   (Knowledge Service dựa vào điều này để gắn vector đúng chunk).
 * - Vector trả về phải L2-normalized hoặc đơn vị theo quy ước provider;
 *   vector store luôn dùng phép đo cosine nên cần vector khác 0.
 */
export interface IEmbeddingClient {
  /** Tên model embedding đang dùng (để ghi log/trace). */
  readonly model: string;

  /** Số chiều vector sinh ra. Phải khớp `EMBEDDING_DIMENSIONS`. */
  readonly dimensions: number;

  /** Sinh vector cho một mảng văn bản (tài liệu hoặc câu hỏi). */
  embed(texts: string[]): Promise<EmbedBatchResult>;

  /** Tiện lợi: sinh vector cho đúng một câu truy vấn (Semantic Search). */
  embedQuery(text: string): Promise<number[]>;
}
