"use strict";
/**
 * Memory Module — Shared contracts dùng chung cho API & Web.
 * Tương ứng bảng Prisma `MemoryRecord` (apps/api/prisma/schema.prisma).
 *
 * - scope: phạm vi ký ức ("global" xuyên hội thoại | "conversation" gắn với phiên cụ thể)
 * - category: nhóm ký ức ("profile" | "preference" | "fact")
 * - key: khóa duy nhất toàn cục (unique), value: nội dung ký ức
 * - sourceAgentSessionId: truy vết nguồn gốc (nullable — null khi user tạo tay qua Dashboard)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryScope = exports.MemoryCategory = void 0;
const enums_1 = require("../enums");
Object.defineProperty(exports, "MemoryCategory", { enumerable: true, get: function () { return enums_1.MemoryCategory; } });
Object.defineProperty(exports, "MemoryScope", { enumerable: true, get: function () { return enums_1.MemoryScope; } });
//# sourceMappingURL=index.js.map