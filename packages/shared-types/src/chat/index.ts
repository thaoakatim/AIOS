import { MessageRole } from "../enums";

export interface IConversation {
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface IMessage {
    id: string;
    conversationId: string;
    agentSessionId?: string;
    role: MessageRole;
    content: string;
    createdAt: Date;
}

export interface SendMessageDto {
    conversationId?: string;
    content: string;
    documentIds?: string[];
}