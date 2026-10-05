import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadDocumentDto } from './dto/create-knowledge.dto';
import {
  LinkDocumentsToMessageDto,
  QueryDocumentDto,
  RelevantChunksQueryDto,
  ReindexDocumentDto,
  SearchKnowledgeDto,
} from './dto/query-knowledge.dto';
import { UpdateDocumentDto } from './dto/update-knowledge.dto';
import { KnowledgeService } from './knowledge.service';

/**
 * REST API của Knowledge & RAG Module (Task 2.2).
 *
 * Lưu ý thứ tự khai báo route: NestJS khớp theo thứ tự, nên mọi route tĩnh
 * (`search`, `context`, `messages/:id/documents`) PHẢI nằm TRƯỚC `:id` để
 * không bị nuốt nhầm vào route có tham số động.
 *
 * Multer được cấu hình `memoryStorage` (giữ file trong RAM) để pipeline RAG
 * đọc buffer trực tiếp — đồng thời `LocalStorageService` vẫn lưu bản gốc
 * xuống đĩa để có thể reindex khi cần.
 */
const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  // ------------------------------------------------------------- Upload --

  /**
   * `POST /knowledge/upload` — pipeline RAG đầy đủ:
   * Upload → Extraction → Chunking → Embedding → Vector Store.
   *
   * Body (multipart/form-data, field `file`):
   * - `title`, `fileType`, `chunkSize`, `chunkOverlap`, `mode`
   * - `messageIds` (JSON string mảng UUID) — gắn tài liệu vào tin nhắn.
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.knowledgeService.upload(file, {
      ...dto,
      // `messageIds` tới từ multipart là string -> parse lại thành mảng.
      messageIds: this.parseIdList(dto.messageIds),
    });
  }

  // ------------------------------------------------------------- Search --

  /**
   * `GET /knowledge/search?q=...&limit=5&minScore=0.3&documentId=...`
   *
   * Semantic Search: câu hỏi → embedding → cosine similarity trong Vector DB.
   */
  @Get('search')
  search(
    @Query('query') query?: string,
    @Query('q') aliasQuery?: string,
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
    @Query('documentId') documentId?: string,
  ) {
    const dto: SearchKnowledgeDto = {
      query: query ?? aliasQuery,
      limit: limit !== undefined ? Number(limit) : undefined,
      minScore: minScore !== undefined ? Number(minScore) : undefined,
      documentId,
    };
    return this.knowledgeService.search(dto);
  }

  /**
   * `GET /knowledge/context?query=...` — trả về RAG context đã sẵn sàng chèn
   * vào prompt (tương tự `GET /memory/context-profile` của Memory Module).
   * Chat Module (Task 2.3) dùng endpoint này khi cần debug context RAG.
   */
  @Get('context')
  async getContext(
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
    @Query('documentId') documentId?: string,
  ) {
    const dto: RelevantChunksQueryDto = {
      query,
      limit: limit !== undefined ? Number(limit) : undefined,
      minScore: minScore !== undefined ? Number(minScore) : undefined,
      documentIds: documentId ? [documentId] : undefined,
    };
    const chunks = await this.knowledgeService.getRelevantChunks(
      query ?? '',
      dto,
    );
    return {
      chunks,
      promptSection: this.knowledgeService.formatChunksForPrompt(chunks),
    };
  }

  /**
   * `POST /knowledge/messages/:messageId/documents` — gắn N tài liệu vào
   * một Message (bảng `MessageDocument`). Idempotent.
   */
  @Post('messages/:messageId/documents')
  @HttpCode(HttpStatus.OK)
  attachToMessage(
    @Param('messageId') messageId: string,
    @Body() dto: LinkDocumentsToMessageDto,
  ) {
    return this.knowledgeService.attachDocumentsToMessage(messageId, dto);
  }

  @Get('messages/:messageId/documents')
  findByMessage(@Param('messageId') messageId: string) {
    return this.knowledgeService.findDocumentsByMessage(messageId);
  }

  @Delete('messages/:messageId/documents/:documentId')
  @HttpCode(HttpStatus.OK)
  detachFromMessage(
    @Param('messageId') messageId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.knowledgeService.detachDocumentFromMessage(
      messageId,
      documentId,
    );
  }

  /** Thống kê pipeline: số tài liệu theo trạng thái + model embedding đang dùng. */
  @Get('stats')
  stats() {
    return this.knowledgeService.stats();
  }

  // --------------------------------------------------------------- CRUD --

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('fileType') fileType?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const filter: QueryDocumentDto = {
      status,
      fileType,
      search,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
    };
    return this.knowledgeService.findAll(filter);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.knowledgeService.findOne(id);
  }

  /** Xem các chunk đã index của một tài liệu (debug RAG). */
  @Get(':id/chunks')
  findChunks(@Param('id') id: string) {
    return this.knowledgeService.findChunks(id);
  }

  /** Message nào đang đính kèm tài liệu này (truy vết ngược). */
  @Get(':id/messages')
  findMessages(@Param('id') id: string) {
    return this.knowledgeService.findMessageIdsByDocument(id);
  }

  /** Chạy lại pipeline cho tài liệu đã có (đổi model/kiểu chunk, retry khi fail). */
  @Post(':id/reindex')
  @HttpCode(HttpStatus.OK)
  reindex(@Param('id') id: string, @Body() dto: ReindexDocumentDto) {
    return this.knowledgeService.ingest(id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return this.knowledgeService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.knowledgeService.remove(id);
  }

  // ------------------------------------------------------------ Helpers --

  /**
   * `messageIds` trong multipart/form-data chỉ gánh được giá trị chuỗi.
   * Chấp nhận cả JSON array (`'["uuid1","uuid2"]'`) lẫn danh sách ngăn cách
   * bằng dấu phẩy để frontend gọi được theo nhiều cách.
   */
  private parseIdList(raw: unknown): string[] | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (Array.isArray(raw)) return raw.map((item) => String(item));

    // Multipart chỉ gửi được giá trị chuỗi; các kiểu khác coi như không hợp lệ.
    if (typeof raw !== 'string') {
      throw new BadRequestException(
        'Trường "messageIds" phải là chuỗi (JSON array hoặc danh sách UUID ngăn cách bằng dấu phẩy).',
      );
    }

    const value = raw.trim();
    if (value.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new BadRequestException(
          'Trường "messageIds" không phải JSON array hợp lệ. Ví dụ: ["uuid1","uuid2"].',
        );
      }
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === 'string',
        );
      }
    }
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}
