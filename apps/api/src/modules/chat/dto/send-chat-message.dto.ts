export class SendChatMessageDto {
  conversationId?: string;
  content!: string;
  documentIds?: string[];
}
