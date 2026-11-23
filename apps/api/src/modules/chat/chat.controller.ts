import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/entities/authenticated-user.interface';
import { ChatService } from './chat.service';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { QueryConversationDto } from './dto/query-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ---------------------------------------------------- CONVERSATION CRUD --

  @Get('conversations')
  listConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryConversationDto,
  ) {
    return this.chatService.listConversations(user, query);
  }

  @Get('conversations/:id')
  getConversation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.getConversation(id, user);
  }

  @Get('conversations/:id/messages')
  listMessages(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryConversationDto,
  ) {
    return this.chatService.listMessages(id, user, query);
  }

  @Patch('conversations/:id')
  updateConversation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.chatService.updateConversation(id, user, dto);
  }

  @Delete('conversations/:id')
  deleteConversation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.deleteConversation(id, user);
  }

  // ---------------------------------------------------- OBSERVABILITY RUN --

  @Get('runs/:messageId')
  getAgentRun(
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.getAgentRun(messageId, user);
  }

  // -------------------------------------------------------- CHAT TURN API --

  /**
   * Endpoint phản hồi hội thoại đồng bộ (Unary).
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  sendMessage(
    @Body() dto: SendChatMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.sendMessage(dto, user);
  }

  /**
   * Endpoint phản hồi Server-Sent Events (SSE Streaming token-by-token).
   *
   * Quy trình:
   * 1. Validate DTO và khởi tạo Turn TRƯỚC KHI mở SSE headers để nếu có lỗi (400, 404),
   *    client nhận mã HTTP REST chuẩn từ NestJS ExceptionFilter.
   * 2. Thiết lập header text/event-stream chống proxy buffering.
   * 3. Lắng nghe req.on('close') kết hợp AbortController để dừng stream an toàn.
   * 4. Gửi event meta đầu tiên, sau đó yield các token chunk và kết thúc bằng event done.
   */
  @Post('stream')
  @HttpCode(HttpStatus.OK)
  async streamMessage(
    @Body() dto: SendChatMessageDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // 1. Pre-flight Turn Initialization (ném lỗi nếu IDOR documentIds hoặc conversationId sai)
    const turn = await this.chatService.prepareChatTurn(dto, user);

    // 2. Thiết lập SSE Headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 3. Khởi tạo AbortController lắng nghe client ngắt kết nối
    const abortController = new AbortController();
    req.on('close', () => {
      abortController.abort();
    });

    // 4. Stream từng Event
    try {
      for await (const event of this.chatService.executeStreamTurn(
        turn,
        abortController.signal,
      )) {
        if (res.writableEnded) {
          break;
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  }
}
