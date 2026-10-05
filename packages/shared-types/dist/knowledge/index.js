"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentStatus = void 0;
const enums_1 = require("../enums");
Object.defineProperty(exports, "DocumentStatus", { enumerable: true, get: function () { return enums_1.DocumentStatus; } });
//# sourceMappingURL=index.js.map