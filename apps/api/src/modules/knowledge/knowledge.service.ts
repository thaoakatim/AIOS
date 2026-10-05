import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JOB_TYPES,
  QUEUE_NAMES,
  QueueService,
} from '../../infrastructure/redis/queue.service';
import { DocumentProcessorService } from '../../infrastructure/storage/document-processor.service';
import { LocalStorageService } from '../../infrastructure/storage/local-storage.service';
import {
  SearchResult,
  VectorPoint,
} from '../../infrastructure/vector-store/vector-store.interface';
import { VectorStoreFactory } from '../../infrastructure/vector-store/vector-store.factory';
import { EmbeddingGatewayService } from '../../core/llm/embedding-gateway.service';
import { AgentExecutionContext } from '../../core/context/agent-context.interface';
import { UploadDocumentDto } from './dto/create-knowledge.dto';
import {
  LinkDocumentsToMessageDto,
  QueryDocumentDto,
  RelevantChunksQueryDto,
  ReindexDocumentDto,
  SearchKnowledgeDto,
} from './dto/query-knowledge.dto';
import { UpdateDocumentDto } from './dto/update-knowledge.dto';
import {
  DOCUMENT_STATUSES,
  DocumentStatus,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeIngestionResult,
  KnowledgeListResult,
  KnowledgeSearchHit,
  KnowledgeSearchResult,
} from './entities/knowledge.entity';
import { KnowledgeRepository } from './knowledge.repository';
import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  RecursiveTextSplitter,
} from './services/recursive-text-splitter';

/** Tên collection dùng chung cho toàn hệ thống (Qdrant). */
export const KNOWLEDGE_COLLECTION = 'aios_documents';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 50;
const MAX_LINK_DOCUMENTS = 50;
const MIN_CHUNK_SIZE = 64;
const MAX_CHUNK_SIZE = 8000;

/** Các định dạng file mà `DocumentProcessorService` hỗ trợ trích xuất text. */
export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
] as const;

/** Đuôi file -> mime type, dùng khi client không gửi mimetype chuẩn. */
const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
};

/**
 * KnowledgeService — điều phối toàn bộ pipeline RAG (Task 2.2):
 *
 *   Upload → Lưu file (LocalStorage) → Text Extraction → Chunking
 *          (Recursive Splitter) → Embedding Service → Vector Store
 *
 * Quy ước tầng: Service KHÔNG tương tác trực tiếp với database — mọi truy vấn
 * persistence đi qua KnowledgeRepository. Service được phép dùng các adapter
 * hạ tầng (storage, vector store, embedding gateway) vì đó là dependency thực
 * của nghiệp vụ RAG, không phải truy cập DB.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly splitter: RecursiveTextSplitter,
    private readonly storage: LocalStorageService,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly embeddingGateway: EmbeddingGatewayService,
    private readonly vectorStoreFactory: VectorStoreFactory,
    private readonly queue: QueueService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------ Ingestion --

  /**
   * `POST /knowledge/upload` — nhận file multipart và chạy pipeline RAG.
   *
   * @param file Nội dung file do Multer ghi vào memory (memoryStorage).
   * @param dto Tuỳ chọn: title, chunkSize/Overlap, mode sync|queue, messageIds.
   */
  async upload(file: Express.Multer.File, dto: UploadDocumentDto = {}) {
    if (!file) {
      throw new BadRequestException(
        'Thiếu file. Gửi multipart/form-data với field "file".',
      );
    }

    const mimeType = this.resolveMimeType(file.mimetype, file.originalname);
    this.assertSupportedMimeType(mimeType);

    const buffer = file.buffer ?? Buffer.from('');
    if (buffer.length === 0) {
      throw new BadRequestException('File rỗng — không thể xử lý.');
    }

    const title = this.normalizeTitle(dto.title, file.originalname);
    const fileType = this.normalizeFileType(dto.fileType, file.originalname);
    const chunking = this.resolveChunking(dto.chunkSize, dto.chunkOverlap);
    const mode = this.normalizeMode(dto.mode ?? this.defaultProcessingMode());

    // 1) Lưu file gốc xuống Local Storage.
    const stored = await this.storage.saveFile(
      buffer,
      file.originalname,
      mimeType,
    );

    // 2) Tạo record Document với status ban đầu.
    const initialStatus: DocumentStatus =
      mode === 'queue' ? 'pending' : 'processing';
    const document = await this.repository.createDocument({
      title,
      fileType,
      sourceUrl: stored.url,
      status: initialStatus,
    });

    // 3) Gắn vào các Message được chỉ định (bảng MessageDocument — Task 2.2).
    if (dto.messageIds && dto.messageIds.length > 0) {
      await this.attachDocumentsToMessageIds(dto.messageIds, [document.id]);
    }

    this.logger.log(
      `Nhận tài liệu "${title}" (${file.originalname}, ${buffer.length} bytes) -> documentId=${document.id}`,
    );

    if (mode === 'queue') {
      // 4a) Đẩy job BullMQ — ingestion chạy nền, không chặn response
      //      (docs/request-flow.md — Flow 3: Knowledge Ingestion & Indexing).
      const enqueued = await this.enqueueIngestion(document.id, chunking);
      if (enqueued) {
        return {
          document: KnowledgeDocument.fromPrisma(document),
          status: 'pending' as DocumentStatus,
          chunkCount: 0,
          queued: true,
        } satisfies KnowledgeIngestionResult;
      }
      // Redis không sẵn sàng -> fallback xử lý đồng bộ để không bỏ rơi tài liệu.
      this.logger.warn(
        'Không đẩy được job BullMQ (Redis chưa sẵn sàng) — xử lý ingestion đồng bộ thay thế.',
      );
    }

    // 4b) Xử lý đồng bộ.
    return this.ingestBuffer(document, buffer, mimeType, chunking);
  }

  /**
   * Đẩi job ingestion lên BullMQ. Trả về false nếu không đẩy được (Redis chưa
   * sẵn sàng) để caller fallback sang xử lý đồng bộ — ưu tiên "tài liệu không
   * bị bỏ rơi" hơn là trả lỗi cho người dùng.
   */
  private async enqueueIngestion(
    documentId: string,
    chunking: { chunkSize: number; chunkOverlap: number },
  ): Promise<boolean> {
    try {
      await this.queue.addJob(
        QUEUE_NAMES.DOCUMENT_PROCESSING,
        JOB_TYPES.INDEX_DOCUMENT,
        {
          type: JOB_TYPES.INDEX_DOCUMENT,
          payload: { documentId, ...chunking },
        },
      );
      this.logger.log(`Đã đẩy job ingestion tài liệu ${documentId} vào BullMQ`);
      return true;
    } catch (error) {
      this.logger.warn(
        `Enqueue job ingestion ${documentId} thất bại: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Chạy pipeline cho một Document đã tồn tại (dùng cho `reindex` và cho
   * BullMQ worker). Đọc lại file gốc từ Local Storage theo `sourceUrl`.
   */
  async ingest(documentId: string, options: ReindexDocumentDto = {}) {
    const document = await this.repository.findDocumentById(documentId);
    if (!document) {
      throw new NotFoundException(
        `Không tìm thấy tài liệu với id "${documentId}".`,
      );
    }

    // `fileType` lưu dạng đuôi file không có dấu chấm ("pdf", "md", ...)
    // -> dựng lại mime type để `DocumentProcessorService` chọn đúng parser.
    const mimeType = this.resolveMimeType(
      '',
      `.${document.fileType ?? 'txt'}`,
      true,
    );

    const storedId = this.extractStorageId(document.sourceUrl);
    const buffer = storedId ? await this.storage.getFile(storedId) : null;

    if (!buffer || buffer.length === 0) {
      // Không còn file gốc -> đánh dấu failed, giữ nguyên chunk cũ để không
      // mất dữ liệu đã index trước đó.
      await this.markFailed(
        documentId,
        'Không tìm thấy file gốc trên storage.',
      );
      throw new NotFoundException(
        `Không tìm thấy file gốc của tài liệu "${document.title}" trên storage. Hãy upload lại tài liệu.`,
      );
    }

    const chunking = this.resolveChunking(
      options.chunkSize,
      options.chunkOverlap,
    );
    return this.ingestBuffer(document, buffer, mimeType, chunking);
  }

  /**
   * Pipeline chuẩn: Extraction → Chunking → Embedding → Vector Store.
   * Mọi bước đều cập nhật `documents.status` để Dashboard theo dõi được.
   */
  private async ingestBuffer(
    document: {
      id: string;
      title: string;
      fileType: string | null;
      sourceUrl: string | null;
    },
    buffer: Buffer,
    mimeType: string,
    chunking: { chunkSize: number; chunkOverlap: number },
  ): Promise<KnowledgeIngestionResult> {
    const startedAt = Date.now();
    await this.repository.updateDocument(document.id, { status: 'processing' });

    try {
      // Bước 1 — Text Extraction.
      const extracted = await this.documentProcessor.extractText(
        buffer,
        mimeType,
      );
      const text = (extracted.text ?? '').trim();
      if (!text) {
        throw new Error(
          'Không trích xuất được nội dung văn bản (file có thể là scan/image hoặc rỗng).',
        );
      }

      // Bước 2 — Chunking (Recursive Splitter).
      const segments = this.splitter.split(text, {
        chunkSize: chunking.chunkSize,
        chunkOverlap: chunking.chunkOverlap,
      });
      if (segments.length === 0) {
        throw new Error('Văn bản quá ngắn để chia chunk.');
      }

      // Bước 3 — Ghi nội dung chunk vào PostgreSQL (chunks là nguồn hiển thị).
      const chunkDrafts = segments.map((segment, index) => ({
        id: randomUUID(),
        documentId: document.id,
        content: segment.text,
        metadata: {
          // `chunkIndex` phải nằm trong JSONB vì bảng không có cột riêng.
          chunkIndex: index,
          chunkSize: segment.text.length,
          startOffset: segment.start,
          endOffset: segment.end,
          totalChunks: segments.length,
          sourceTitle: document.title,
          fileType: document.fileType,
          extraction: extracted.metadata ?? {},
        },
      }));
      const savedChunks = await this.repository.replaceChunks(
        document.id,
        chunkDrafts,
      );

      // Bước 4 — Embedding Service (vector nhúng cho từng chunk).
      const vectors = await this.embeddingGateway.embedDocuments(
        savedChunks.map((chunk) => chunk.content),
      );
      const expected = this.embeddingGateway.getDimensions();
      if (vectors.length !== savedChunks.length) {
        throw new Error(
          `Embedding trả về ${vectors.length} vector cho ${savedChunks.length} chunk.`,
        );
      }
      if (vectors[0]?.length !== expected) {
        throw new Error(
          `Vector embedding có ${vectors[0]?.length} chiều nhưng cấu hình EMBEDDING_DIMENSIONS=${expected}. Cần khớp với cột vector(768) của database.`,
        );
      }

      // Bước 5 — Lưu Vector DB.
      const store = this.vectorStoreFactory.createStore();
      const points: VectorPoint[] = savedChunks.map((chunk, index) => ({
        id: chunk.id,
        vector: vectors[index],
        payload: {
          documentId: chunk.documentId,
          content: chunk.content,
          metadata: chunk.metadata ?? {},
        },
      }));
      await store.upsert(KNOWLEDGE_COLLECTION, points);

      // Hoàn tất.
      await this.repository.updateDocument(document.id, { status: 'indexed' });
      this.logger.log(
        `Index xong tài liệu ${document.id}: ${savedChunks.length} chunk, ${expected} chiều, ${Date.now() - startedAt}ms`,
      );

      return {
        document: await this.loadDocument(document),
        status: 'indexed' as DocumentStatus,
        chunkCount: savedChunks.length,
        queued: false,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Lỗi không xác định';
      await this.markFailed(document.id, message);
      this.logger.error(
        `Ingestion thất bại cho tài liệu ${document.id}: ${message}`,
      );
      throw new ServiceUnavailableException(
        `Không thể index tài liệu "${document.title}": ${message}`,
      );
    }
  }

  private async markFailed(documentId: string, reason: string): Promise<void> {
    this.logger.warn(`Đánh dấu tài liệu ${documentId} là failed: ${reason}`);
    try {
      await this.repository.updateDocument(documentId, { status: 'failed' });
    } catch (error) {
      this.logger.error(
        `Không cập nhật được status=failed cho ${documentId}: ${String(error)}`,
      );
    }
  }

  /**
   * Đọc lại Document sau khi cập nhật status. Nếu đọc lại thất bại (record vừa
   * bị xoá song song) thì dựng entity từ dữ liệu đang có trong tay — để
   * response upload vẫn phản ánh đúng kết quả pipeline.
   */
  private async loadDocument(document: {
    id: string;
    title: string;
    fileType: string | null;
    sourceUrl: string | null;
  }): Promise<KnowledgeDocument> {
    const refreshed = await this.repository.findDocumentById(document.id);
    if (refreshed) return KnowledgeDocument.fromPrisma(refreshed);

    const fallback = new KnowledgeDocument();
    fallback.id = document.id;
    fallback.title = document.title;
    fallback.fileType = document.fileType;
    fallback.sourceUrl = document.sourceUrl;
    fallback.status = 'indexed';
    fallback.createdAt = new Date();
    return fallback;
  }

  // --------------------------------------------------- Semantic Search --

  /**
   * `GET /knowledge/search` — Semantic Search bằng vector embedding.
   *
   * Luồng: query → Embedding → Vector Store (cosine similarity) →
   * hydrate metadata/nội dung từ PostgreSQL → sắp xếp theo điểm tương đồng.
   */
  async search(dto: SearchKnowledgeDto): Promise<KnowledgeSearchResult> {
    const query = (dto.query ?? '').trim();
    if (!query) {
      throw new BadRequestException(
        'Thiếu truy vấn. GET /knowledge/search?query="câu hỏi của bạn".',
      );
    }

    const limit = this.normalizeLimit(
      dto.limit,
      DEFAULT_SEARCH_LIMIT,
      MAX_SEARCH_LIMIT,
    );
    const minScore = this.normalizeMinScore(dto.minScore);
    if (dto.documentId !== undefined) {
      this.assertUuid(dto.documentId, 'documentId');
    }

    // 1) Vector embedding cho câu hỏi.
    const queryVector = await this.embeddingGateway.embedQuery(query);

    // 2) Tìm chunk tương đồng trong Vector Store.
    const store = this.vectorStoreFactory.createStore();
    const filter = dto.documentId ? { documentId: dto.documentId } : undefined;
    const hits = await store.searchSimilarity(
      KNOWLEDGE_COLLECTION,
      queryVector,
      // Lấy dư để lọc theo minScore mà không mất kết quả hợp lệ.
      filter ? limit : Math.min(limit * 4, MAX_SEARCH_LIMIT * 4),
      filter,
    );

    // 3) Hydrate nội dung + tiêu đề tài liệu từ PostgreSQL.
    const enriched = await this.hydrateHits(hits, minScore, limit);

    return {
      query,
      data: enriched,
      total: enriched.length,
      embedding: {
        model: this.embeddingGateway.getModel(),
        dimensions: this.embeddingGateway.getDimensions(),
      },
    };
  }

  /** Gắn nội dung chunk + tiêu đề tài liệu vào kết quả vector search. */
  private async hydrateHits(
    hits: SearchResult[],
    minScore: number,
    limit: number,
  ): Promise<KnowledgeSearchHit[]> {
    if (hits.length === 0) return [];

    const filtered = hits.filter((hit) => hit.score >= minScore);
    if (filtered.length === 0) return [];

    const chunkIds = filtered.map((hit) => hit.id);
    const documentIds = [
      ...new Set(
        filtered
          .map((hit) => hit.payload?.documentId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];

    const [chunks, documents] = await Promise.all([
      this.repository.findChunksByIds(chunkIds),
      documentIds.length > 0
        ? this.repository.findDocumentsByIds(documentIds)
        : Promise.resolve([]),
    ]);

    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const titleById = new Map(documents.map((doc) => [doc.id, doc.title]));

    const result: KnowledgeSearchHit[] = [];
    for (const hit of filtered) {
      if (result.length >= limit) break;
      const chunk = chunkById.get(hit.id);
      if (!chunk) continue; // Chunk đã bị xoá khỏi DB -> bỏ qua.
      // Payload của vector store là `Record<string, unknown>` nên phải ép kiểu
      // tường minh thay vì `String(...)` (tránh "[object Object]" khi value
      // không phải chuỗi).
      const payloadDocumentId = hit.payload?.documentId;
      const documentId =
        typeof payloadDocumentId === 'string'
          ? payloadDocumentId
          : chunk.documentId;
      const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
      const rawIndex = metadata.chunkIndex;

      result.push({
        chunkId: chunk.id,
        documentId,
        documentTitle: titleById.get(documentId) ?? 'Tài liệu đã xoá',
        content: chunk.content,
        score: Number(hit.score),
        chunkIndex:
          typeof rawIndex === 'number' && Number.isFinite(rawIndex)
            ? rawIndex
            : 0,
        metadata,
      });
    }

    return result;
  }

  // ------------------------------ Điểm tích hợp cho Chat Module (2.3) --

  /**
   * Truy hồi chunk RAG cho `AgentExecutionContext` — tương xứng với
   * `MemoryService.getRelevantMemory(ctx)`.
   *
   * Chat/Agent Engine (Task 2.3) gọi hàm này để nạp
   * `ctx.prefetch.ragChunks` trước khi build prompt.
   */
  async getRelevantChunks(
    ctxOrQuery: AgentExecutionContext | string,
    options: RelevantChunksQueryDto = {},
  ): Promise<KnowledgeSearchHit[]> {
    const query =
      typeof ctxOrQuery === 'string' ? ctxOrQuery : (ctxOrQuery.query ?? '');
    const documentIds = this.collectDocumentIds(ctxOrQuery, options);

    try {
      const result = await this.search({
        query,
        limit: options.limit,
        minScore: options.minScore,
        // Vector Store chỉ hỗ trợ filter một documentId (đúng với
        // `IVectorStore`) nên chỉ đẩy xuống được khi có đúng 1 tài liệu.
        ...(documentIds.length === 1 ? { documentId: documentIds[0] } : {}),
      });

      if (documentIds.length === 0) return result.data;

      // Luôn lọc lại ở tầng service (kể cả khi đã filter ở vector store):
      // đây là lưới an toàn để tài liệu ngoài phạm vi không lọt vào context.
      const allowed = new Set(documentIds);
      return result.data.filter((hit) => allowed.has(hit.documentId));
    } catch (error) {
      // Theo docs/request-flow.md §6: Vector DB/Embedding lỗi -> bỏ qua RAG,
      // vẫn cho phép hội thoại bình thường bằng Memory + Chat History.
      this.logger.warn(
        `Bỏ qua RAG context do lỗi truy vấn tri thức: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /**
   * Ưu tiên tài liệu đính kèm trực tiếp vào Message hiện tại (bảng
   * `MessageDocument`) — đây là ngữ cảnh RAG đáng tin cậy nhất.
   */
  private collectDocumentIds(
    ctxOrQuery: AgentExecutionContext | string,
    options: RelevantChunksQueryDto,
  ): string[] {
    const explicit = options.documentIds ?? [];
    if (explicit.length > 0) return explicit;
    if (typeof ctxOrQuery === 'string') return [];
    const fromMetadata = ctxOrQuery.metadata?.documentIds;
    return Array.isArray(fromMetadata)
      ? fromMetadata.filter((id): id is string => typeof id === 'string')
      : [];
  }

  /** Render chunk RAG thành đoạn prompt sẵn sàng chèn cho LLM. */
  formatChunksForPrompt(hits: KnowledgeSearchHit[]): string {
    if (hits.length === 0) return '';
    const blocks = hits.map(
      (hit, index) =>
        `[${index + 1}] (${hit.documentTitle} #${hit.chunkIndex}, score=${hit.score.toFixed(3)})\n${hit.content}`,
    );
    return `## Knowledge Base (RAG)\n${blocks.join('\n\n')}`;
  }

  /**
   * Pipeline 1 lệnh cho Chat Context Builder: truy hồi + trả về prompt block.
   * Trả về cả `ragChunks` (để nạp vào `ctx.prefetch.ragChunks`) và chuỗi
   * prompt tương ứng.
   */
  async injectIntoContext(
    ctx: AgentExecutionContext,
    options: RelevantChunksQueryDto = {},
  ): Promise<{
    context: AgentExecutionContext;
    chunks: KnowledgeSearchHit[];
    promptSection: string;
  }> {
    const chunks = await this.getRelevantChunks(ctx, options);
    const context: AgentExecutionContext = {
      ...ctx,
      prefetch: {
        ...ctx.prefetch,
        ragChunks: chunks.map((hit) => this.toPrefetchChunk(hit)),
      },
    };
    return {
      context,
      chunks,
      promptSection: this.formatChunksForPrompt(chunks),
    };
  }

  /** Chiếu `KnowledgeSearchHit` sang shape của `AgentExecutionContext.prefetch.ragChunks`. */
  private toPrefetchChunk(hit: KnowledgeSearchHit) {
    return {
      id: hit.chunkId,
      documentId: hit.documentId,
      content: hit.content,
      metadata: {
        ...hit.metadata,
        chunkIndex: hit.chunkIndex,
        documentTitle: hit.documentTitle,
        score: hit.score,
      },
    };
  }

  // -------------------------------------------------------- Message ↔ Doc --

  /**
   * Gắn nhiều tài liệu vào một Message (`POST /knowledge/messages/:id/documents`).
   * Idempotent nhờ `skipDuplicates` ở repository.
   */
  async attachDocumentsToMessage(
    messageId: string,
    dto: LinkDocumentsToMessageDto,
  ): Promise<{ messageId: string; linked: string[]; skipped: string[] }> {
    this.assertUuid(messageId, 'messageId');
    const documentIds = this.normalizeDocumentIds(dto.documentIds);
    await this.assertMessageExists(messageId);
    await this.assertDocumentsExist(documentIds);

    const alreadyLinked = await this.repository.existingLinkedDocumentIds(
      messageId,
      documentIds,
    );
    const skipped = documentIds.filter((id) => alreadyLinked.includes(id));
    const toLink = documentIds.filter((id) => !alreadyLinked.includes(id));

    await this.repository.linkDocumentsToMessage({
      messageId,
      documentIds: toLink,
    });

    return { messageId, linked: toLink, skipped };
  }

  /** Gỡ một tài liệu khỏi Message. */
  async detachDocumentFromMessage(
    messageId: string,
    documentId: string,
  ): Promise<{ messageId: string; documentId: string; removed: number }> {
    this.assertUuid(messageId, 'messageId');
    this.assertUuid(documentId, 'documentId');
    const { count } = await this.repository.unlinkDocumentFromMessage(
      messageId,
      documentId,
    );
    if (count === 0) {
      throw new NotFoundException(
        `Tài liệu "${documentId}" không được gắn vào message "${messageId}".`,
      );
    }
    return { messageId, documentId, removed: count };
  }

  /** Tài liệu đính kèm của một Message — dùng để UI hiển thị attachment. */
  async findDocumentsByMessage(
    messageId: string,
  ): Promise<KnowledgeDocument[]> {
    this.assertUuid(messageId, 'messageId');
    const documents = await this.repository.listDocumentsForMessage(messageId);
    return KnowledgeDocument.fromPrismaMany(documents);
  }

  /** Danh sách message nào đang dùng một tài liệu (truy vết ngược). */
  async findMessageIdsByDocument(documentId: string): Promise<string[]> {
    this.assertUuid(documentId, 'documentId');
    return this.repository.listMessagesForDocument(documentId);
  }

  /** Helper nội bộ: gắn nhiều tài liệu vào nhiều message (dùng lúc upload). */
  private async attachDocumentsToMessageIds(
    messageIds: string[],
    documentIds: string[],
  ): Promise<void> {
    const validMessages = messageIds.filter((id) => this.isUuid(id));
    const validDocuments = documentIds.filter((id) => this.isUuid(id));
    if (validMessages.length === 0 || validDocuments.length === 0) return;

    await this.assertDocumentsExist(validDocuments);
    for (const messageId of validMessages) {
      await this.assertMessageExists(messageId);
      await this.repository.linkDocumentsToMessage({
        messageId,
        documentIds: validDocuments,
      });
    }
  }

  // ----------------------------------------------------------------- CRUD --

  /** Danh sách tài liệu cho Knowledge Hub (có phân trang + lọc trạng thái). */
  async findAll(filter: QueryDocumentDto = {}): Promise<KnowledgeListResult> {
    if (filter.status !== undefined) this.normalizeStatus(filter.status);
    const { limit, offset } = this.normalizePagination(
      filter.limit,
      filter.offset,
    );

    const { records, total } = await this.repository.findDocumentsAndCount({
      status:
        filter.status === undefined
          ? undefined
          : this.normalizeStatus(filter.status),
      fileType: filter.fileType,
      search: filter.search,
      take: limit,
      skip: offset,
    });

    return { data: KnowledgeDocument.fromPrismaMany(records), total };
  }

  async findOne(id: string): Promise<KnowledgeDocument> {
    this.assertUuid(id, 'id');
    const document = await this.repository.findDocumentById(id);
    if (!document) {
      throw new NotFoundException(`Không tìm thấy tài liệu với id "${id}".`);
    }
    return KnowledgeDocument.fromPrisma(document);
  }

  /** Chunk của một tài liệu, sắp theo `metadata.chunkIndex`. */
  async findChunks(documentId: string): Promise<KnowledgeChunk[]> {
    this.assertUuid(documentId, 'documentId');
    await this.findOne(documentId);
    const chunks = await this.repository.findChunksByDocumentId(documentId);
    return KnowledgeChunk.fromPrismaMany(chunks).sort(
      (a, b) => a.chunkIndex - b.chunkIndex,
    );
  }

  async update(id: string, dto: UpdateDocumentDto): Promise<KnowledgeDocument> {
    this.assertUuid(id, 'id');
    await this.findOne(id);
    const updated = await this.repository.updateDocument(id, {
      title:
        dto.title === undefined ? undefined : this.normalizeTitle(dto.title),
      status:
        dto.status === undefined ? undefined : this.normalizeStatus(dto.status),
    });
    return KnowledgeDocument.fromPrisma(updated);
  }

  /**
   * Xoá tài liệu: xoá vector trước rồi mới xoá row trong DB (cascade sẽ xoá
   * luôn `document_chunks` và `message_documents`). Với Qdrant, vector nằm ở
   * collection riêng nên phải xoá thủ công; với pgvector, adapter xoá theo id
   * chunk trên cùng bảng — cả hai đều an toàn khi gọi trước.
   */
  async remove(id: string): Promise<KnowledgeDocument> {
    this.assertUuid(id, 'id');
    const document = await this.findOne(id);

    const chunks = await this.repository.findChunksByDocumentId(id);
    if (chunks.length > 0) {
      try {
        await this.vectorStoreFactory.createStore().delete(
          KNOWLEDGE_COLLECTION,
          chunks.map((chunk) => chunk.id),
        );
      } catch (error) {
        this.logger.warn(
          `Không xoá được vector của tài liệu ${id} trong vector store: ${String(error)}`,
        );
      }
    }

    await this.repository.deleteDocument(id);
    this.logger.log(`Xoá tài liệu ${id} (${chunks.length} chunk)`);
    return document;
  }

  /** Thống kê nhanh cho Health check / Dashboard. */
  async stats(): Promise<{
    documentsByStatus: Record<string, number>;
    embedding: { provider: string; model: string; dimensions: number };
    collection: string;
  }> {
    return {
      documentsByStatus: await this.repository.countDocumentsByStatus(),
      embedding: {
        provider: this.embeddingGateway.getProvider(),
        model: this.embeddingGateway.getModel(),
        dimensions: this.embeddingGateway.getDimensions(),
      },
      collection: KNOWLEDGE_COLLECTION,
    };
  }

  // ---------------------------------------------------------- Helpers --

  private defaultProcessingMode(): string {
    return this.config.get<string>('KNOWLEDGE_PROCESSING_MODE') ?? 'sync';
  }

  private normalizeMode(mode: unknown): 'sync' | 'queue' {
    if (typeof mode !== 'string') return 'sync';
    const normalized = mode.trim().toLowerCase();
    if (normalized === 'queue') return 'queue';
    if (normalized === 'sync' || normalized === '') return 'sync';
    throw new BadRequestException(
      `Trường "mode" phải là "sync" hoặc "queue". Nhận được: "${mode}".`,
    );
  }

  private resolveChunking(
    chunkSize?: number,
    chunkOverlap?: number,
  ): { chunkSize: number; chunkOverlap: number } {
    const configuredSize = Number(
      chunkSize ??
        this.config.get<string>('KNOWLEDGE_CHUNK_SIZE') ??
        DEFAULT_CHUNK_SIZE,
    );
    const configuredOverlap = Number(
      chunkOverlap ??
        this.config.get<string>('KNOWLEDGE_CHUNK_OVERLAP') ??
        DEFAULT_CHUNK_OVERLAP,
    );

    const size = Number.isFinite(configuredSize)
      ? Math.floor(configuredSize)
      : DEFAULT_CHUNK_SIZE;
    if (size < MIN_CHUNK_SIZE || size > MAX_CHUNK_SIZE) {
      throw new BadRequestException(
        `Trường "chunkSize" phải nằm trong [${MIN_CHUNK_SIZE}, ${MAX_CHUNK_SIZE}].`,
      );
    }

    const overlap = Number.isFinite(configuredOverlap)
      ? Math.floor(configuredOverlap)
      : DEFAULT_CHUNK_OVERLAP;
    if (overlap < 0 || overlap >= size) {
      throw new BadRequestException(
        `Trường "chunkOverlap" phải nằm trong [0, chunkSize).`,
      );
    }

    return { chunkSize: size, chunkOverlap: overlap };
  }

  private normalizeTitle(title: unknown, fallbackFileName?: string): string {
    if (typeof title === 'string' && title.trim()) {
      const trimmed = title.trim();
      if (trimmed.length > 300) {
        throw new BadRequestException(
          'Trường "title" không được vượt quá 300 ký tự.',
        );
      }
      return trimmed;
    }
    if (fallbackFileName && fallbackFileName.trim()) {
      return fallbackFileName.trim().slice(0, 300);
    }
    throw new BadRequestException('Trường "title" là bắt buộc.');
  }

  private normalizeFileType(fileType: unknown, fileName?: string): string {
    if (typeof fileType === 'string' && fileType.trim()) {
      return fileType.trim().toLowerCase().replace(/^\./u, '');
    }
    const extension = (fileName ?? '').split('.').pop();
    return extension ? extension.toLowerCase() : 'txt';
  }

  private normalizeStatus(status: unknown): DocumentStatus {
    if (typeof status !== 'string') {
      throw new BadRequestException(
        `Trường "status" phải là một trong: ${DOCUMENT_STATUSES.join(', ')}.`,
      );
    }
    const normalized = status.trim().toLowerCase();
    if (!(DOCUMENT_STATUSES as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `Status "${status}" không hợp lệ. Cho phép: ${DOCUMENT_STATUSES.join(', ')}.`,
      );
    }
    return normalized as DocumentStatus;
  }

  private normalizeLimit(
    value: number | undefined,
    fallback: number,
    max: number,
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.floor(parsed), max);
  }

  private normalizePagination(
    limit?: number,
    offset?: number,
  ): { limit: number; offset: number } {
    return {
      limit: this.normalizeLimit(limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
      offset:
        Number.isFinite(Number(offset)) && Number(offset) >= 0
          ? Math.floor(Number(offset))
          : 0,
    };
  }

  private normalizeMinScore(minScore: unknown): number {
    if (minScore === undefined || minScore === null) return 0;
    const parsed = Number(minScore);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      throw new BadRequestException(
        'Trường "minScore" phải là số trong khoảng [0, 1].',
      );
    }
    return parsed;
  }

  private normalizeDocumentIds(documentIds: unknown): string[] {
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      throw new BadRequestException(
        'Trường "documentIds" phải là mảng không rỗng.',
      );
    }
    if (documentIds.length > MAX_LINK_DOCUMENTS) {
      throw new BadRequestException(
        `Chỉ gắn tối đa ${MAX_LINK_DOCUMENTS} tài liệu vào một message.`,
      );
    }
    for (const id of documentIds) {
      this.assertUuid(id, 'documentIds');
    }
    return documentIds as string[];
  }

  /** Suy ra mime type từ mimetype của client, fallback sang đuôi file. */
  private resolveMimeType(
    mimeType: string,
    fileName: string,
    fromFileTypeOnly = false,
  ): string {
    const provided = (mimeType ?? '').split(';')[0].trim().toLowerCase();
    if (provided && !fromFileTypeOnly) {
      if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(provided)) {
        return provided;
      }
      // Một số browser gửi "text/markdown" lẫn "text/x-markdown" hoặc
      // "application/octet-stream" cho file .md -> thử suy ra từ đuôi file.
      const byExtension = this.mimeFromFileName(fileName);
      if (byExtension) return byExtension;
      return provided;
    }
    return this.mimeFromFileName(fileName) ?? 'text/plain';
  }

  private mimeFromFileName(fileName: string): string | null {
    if (!fileName) return null;
    const extension = fileName.includes('.')
      ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
      : '';
    return EXTENSION_TO_MIME[extension] ?? null;
  }

  private assertSupportedMimeType(mimeType: string): void {
    if (!(SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new BadRequestException(
        `Định dạng "${mimeType}" chưa được hỗ trợ. Cho phép: PDF, DOCX, DOC, TXT, Markdown.`,
      );
    }
  }

  /** Lấy id file đã lưu từ url mà LocalStorageService sinh ra. */
  private extractStorageId(sourceUrl: string | null): string | null {
    if (!sourceUrl) return null;
    const filename = sourceUrl.split('/').pop();
    return filename ? filename.replace(/\.[^.]+$/u, '') : null;
  }

  private async assertMessageExists(messageId: string): Promise<void> {
    if (!this.isUuid(messageId)) {
      throw new BadRequestException(
        `Trường "messageId" phải là UUID hợp lệ. Nhận được: "${messageId}".`,
      );
    }
    if (!(await this.repository.messageExists(messageId))) {
      throw new NotFoundException(
        `Không tìm thấy Message với id "${messageId}".`,
      );
    }
  }

  private async assertDocumentsExist(documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) return;
    const found = await this.repository.findDocumentsByIds(documentIds);
    const foundIds = new Set(found.map((document) => document.id));
    const missing = documentIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `Không tìm thấy tài liệu: ${missing.join(', ')}.`,
      );
    }
  }

  private assertUuid(value: unknown, field: string): void {
    if (typeof value !== 'string' || !this.isUuid(value)) {
      throw new BadRequestException(
        `Trường "${field}" phải là UUID hợp lệ. Nhận được: "${String(value)}".`,
      );
    }
  }

  private isUuid(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        value,
      )
    );
  }
}
