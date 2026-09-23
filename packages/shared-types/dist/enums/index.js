"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryCategory = exports.MemoryScope = exports.DocumentStatus = exports.TaskStatus = exports.AgentRunStatus = exports.MessageRole = void 0;
var MessageRole;
(function (MessageRole) {
    MessageRole["USER"] = "user";
    MessageRole["ASSISTANT"] = "assistant";
    MessageRole["TOOL"] = "tool";
    MessageRole["SYSTEM"] = "system";
})(MessageRole || (exports.MessageRole = MessageRole = {}));
var AgentRunStatus;
(function (AgentRunStatus) {
    AgentRunStatus["RUNNING"] = "running";
    AgentRunStatus["TOOL_CALLING"] = "tool_calling";
    AgentRunStatus["COMPLETED"] = "completed";
    AgentRunStatus["FAILED"] = "failed";
})(AgentRunStatus || (exports.AgentRunStatus = AgentRunStatus = {}));
var TaskStatus;
(function (TaskStatus) {
    TaskStatus["TODO"] = "todo";
    TaskStatus["IN_PROGRESS"] = "in_progress";
    TaskStatus["DONE"] = "done";
    TaskStatus["BLOCKED"] = "blocked";
})(TaskStatus || (exports.TaskStatus = TaskStatus = {}));
var DocumentStatus;
(function (DocumentStatus) {
    DocumentStatus["PENDING"] = "pending";
    DocumentStatus["PROCESSING"] = "processing";
    DocumentStatus["INDEXED"] = "indexed";
    DocumentStatus["FAILED"] = "failed";
})(DocumentStatus || (exports.DocumentStatus = DocumentStatus = {}));
var MemoryScope;
(function (MemoryScope) {
    MemoryScope["GLOBAL"] = "global";
    MemoryScope["CONVERSATION"] = "conversation";
})(MemoryScope || (exports.MemoryScope = MemoryScope = {}));
var MemoryCategory;
(function (MemoryCategory) {
    MemoryCategory["PROFILE"] = "profile";
    MemoryCategory["PREFERENCE"] = "preference";
    MemoryCategory["FACT"] = "fact";
})(MemoryCategory || (exports.MemoryCategory = MemoryCategory = {}));
//# sourceMappingURL=index.js.map