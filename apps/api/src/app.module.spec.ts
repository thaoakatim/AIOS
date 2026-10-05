import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { KnowledgeService } from './modules/knowledge/knowledge.service';
import { KnowledgeRepository } from './modules/knowledge/knowledge.repository';
import { RecursiveTextSplitter } from './modules/knowledge/services/recursive-text-splitter';
import { MemoryService } from './modules/memory/memory.service';
import { EmbeddingGatewayService } from './core/llm/embedding-gateway.service';

/**
 * Smoke test cho toàn bộ dependency injection graph của ứng dụng.
 *
 * `compile()` KHÔNG gọi lifecycle hook (`onModuleInit`) nên test này không
 * cần PostgreSQL/Redis/Qdrant thật — nó chỉ chứng minh mọi provider đều có
 * thể được khởi tạo từ các token mà chúng inject.
 *
 * Giá trị lớn nhất: bắt được lỗi thiếu `ConfigModule.forRoot()` (mọi adapter
 * hạ tầng đều inject `ConfigService`) và lỗi provider thiếu trong module.
 */
describe('AppModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => {
    await module?.close();
  });

  it('should compile the whole dependency graph', () => {
    expect(module).toBeDefined();
  });

  it('registers the global ConfigModule required by infrastructure adapters', () => {
    expect(ConfigModule).toBeDefined();
    expect(module.get(ConfigService, { strict: false })).toBeDefined();
  });

  it('resolves the Knowledge & RAG providers', () => {
    expect(module.get(KnowledgeService, { strict: false })).toBeDefined();
    expect(module.get(KnowledgeRepository, { strict: false })).toBeDefined();
    expect(module.get(RecursiveTextSplitter, { strict: false })).toBeDefined();
  });

  it('resolves the Embedding Gateway used by the RAG pipeline', () => {
    const gateway = module.get(EmbeddingGatewayService, { strict: false });
    expect(gateway).toBeDefined();
    // Chiều vector mặc định phải khớp cột `vector(768)` của document_chunks.
    expect(gateway.getDimensions()).toBe(768);
  });

  it('keeps MemoryService resolvable for the Chat Context Builder', () => {
    expect(module.get(MemoryService, { strict: false })).toBeDefined();
  });
});
