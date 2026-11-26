"use strict";
/**
 * Planner Module — Shared contracts dùng chung cho API & Web/Desktop.
 * Tương ứng bảng Prisma `Plan` và `Task` (apps/api/prisma/schema.prisma).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStatus = exports.PlanStatus = void 0;
const enums_1 = require("../enums");
Object.defineProperty(exports, "PlanStatus", { enumerable: true, get: function () { return enums_1.PlanStatus; } });
Object.defineProperty(exports, "TaskStatus", { enumerable: true, get: function () { return enums_1.TaskStatus; } });
//# sourceMappingURL=index.js.map