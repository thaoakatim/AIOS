import {
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
} from '@nestjs/common';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { QueryMemoryDto, RelevantMemoryQueryDto } from './dto/query-memory.dto';
import { UpdateMemoryDto } from './dto/update-memory.dto';
import { MemoryService } from './memory.service';

/**
 * REST API quản lý ký ức dài hạn (Memory Board cho Dashboard + backend
 * cho Chat Context Builder ở Task 2.3).
 *
 * Lưu ý thứ tự route: các route tĩnh (`relevant`, `key/:key`, `upsert`,
 * `context-profile`) phải khai báo TRƯỚC `:id` để NestJS không nhầm
 * "relevant" thành id.
 */
@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post()
  create(@Body() createMemoryDto: CreateMemoryDto) {
    return this.memoryService.create(createMemoryDto);
  }

  /**
   * Upsert幂等 theo key — Agent gọi khi tự học được sự thật mới
   * ("remember: user thích dark mode") mà không cần biết key đã tồn tại.
   */
  @Post('upsert')
  @HttpCode(HttpStatus.OK)
  upsert(@Body() createMemoryDto: CreateMemoryDto) {
    return this.memoryService.upsert(createMemoryDto);
  }

  @Get()
  findAll(
    @Query('scope') scope?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('sourceAgentSessionId') sourceAgentSessionId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const filter: QueryMemoryDto = {
      scope,
      category,
      search,
      sourceAgentSessionId,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
    };
    return this.memoryService.findAll(filter);
  }

  /**
   * Truy hồi ký ức liên quan cho một query — Chat Module (Task 2.3)
   * gọi endpoint này (hoặc `MemoryService.getRelevantMemory` trực tiếp)
   * để nạp vào AgentExecutionContext trước khi build prompt.
   */
  @Get('relevant')
  getRelevant(
    @Query('query') query?: string,
    @Query('sessionId') sessionId?: string,
    @Query('scope') scope?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ) {
    const dto: RelevantMemoryQueryDto = {
      query,
      sessionId,
      scope,
      category,
      limit: limit !== undefined ? Number(limit) : undefined,
    };
    return this.memoryService.getRelevantMemoryByQuery(dto);
  }

  /**
   * Trả về dạng đã sẵn sàng inject: userProfile map + đoạn prompt.
   * Context Builder chỉ cần ghép `promptSection` vào system prompt.
   */
  @Get('context-profile')
  async getContextProfile(
    @Query('query') query?: string,
    @Query('sessionId') sessionId?: string,
    @Query('scope') scope?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ) {
    const memories = await this.memoryService.getRelevantMemoryByQuery({
      query,
      sessionId,
      scope,
      category,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    return {
      userProfile: this.memoryService.buildUserProfile(memories),
      promptSection: this.memoryService.formatMemoryForPrompt(memories),
      memories,
    };
  }

  @Get('key/:key')
  findByKey(@Param('key') key: string) {
    return this.memoryService.findByKey(key);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.memoryService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateMemoryDto: UpdateMemoryDto) {
    return this.memoryService.update(id, updateMemoryDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.memoryService.remove(id);
  }
}
