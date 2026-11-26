# AGENTS.md — AIOS Engineering, Architecture & Business Rules

This file is the canonical instruction manual for AI coding agents working in the **AIOS (Personal AI Operating System)** monorepo. Read this file before starting any task in a new conversation.

---

## 1. Project Identity & Scope

- **What AIOS is:** A **Personal Chief of Staff** built as a **Modular Monolith & Clean Architecture** system, centered on a **Message-Centric Design** (`Message` triggers `AgentRun`, `Workflow`, and `MessageDocument`).
- **Product Topology:**
  - `apps/api`: NestJS Backend / Local Companion (REST + SSE, loopback `127.0.0.1` on desktop).
  - `apps/web`: React 19 + Vite Web Client (connects to Local Companion via PNA + scoped pairing, or runs account/download portal when unpaired).
  - `apps/desktop` *(planned Phase 8)*: Electron shell bundling UI + NestJS sidecar with **PGlite (WASM Postgres + `pgvector` + SQL `IJobQueue`)** for a Zero-Daemon desktop runtime.
  - `packages/shared-types`: Shared DTOs, enums, and contracts (`@aios/shared-types`).
  - `docker/`: Local dev stack (`postgres` with `pgvector` on `:5433`, `redis` on `:6378`, `qdrant` on `:6333`, optional profiles: `auth` for Keycloak `:8080`, `tools` for Adminer `:8088` & Redis Commander `:8081`, `ollama` `:11434`).
- **Out of Scope (MVP Constraints):**
  - No payment/billing, no public multi-tenant SaaS admin/roles, no microservices split, no Kubernetes, no mobile apps.
- **Key Documentation:**
  - Roadmap & current progress: `docs/task_list.md`
  - Architecture & Caremate principles: `docs/architecture.md`
  - Module boundaries: `docs/module-decomposition.md`
  - End-to-end flows: `docs/request-flow.md`
  - Web/Desktop/Companion plan: `docs/plan/architecture-web-desktop-local-companion.md`
  - Module rules: `docs/modules_rule/` (`auth-module.md`, `chat-module.md`, `knowledge-module.md`, `memory-module.md`)

---

## 2. Package Manager, Commands & Verification

This repository uses **pnpm workspaces** (`pnpm-workspace.yaml`, `.npmrc` configured for pnpm v10+ `onlyBuiltDependencies`). Always use `pnpm` (do not run `npm install` or commit `package-lock.json` changes).

### Common Commands (Run from repo root)

```bash
# Install dependencies
pnpm install

# Build shared types FIRST whenever packages/shared-types changes
pnpm --filter @aios/shared-types build

# Build all packages / individual apps
pnpm run build            # pnpm -r build
pnpm run build:api        # pnpm --filter api build
pnpm run build:web        # pnpm --filter web build

# Run dev servers (run in separate terminals; root has no combined `dev` script)
pnpm run dev:api          # nest start --watch
pnpm run dev:web          # vite

# Lint & Format
pnpm --filter api lint    # eslint "{src,apps,libs,test}/**/*.ts" --fix
pnpm --filter api format  # prettier --write "src/**/*.ts" "test/**/*.ts"
pnpm --filter web lint    # eslint .

# Tests (apps/api)
pnpm --filter api test        # jest unit tests (*.spec.ts under src/)
pnpm --filter api test:watch
pnpm --filter api test:cov
pnpm --filter api test:e2e    # jest --config ./test/jest-e2e.json

# Prisma (apps/api)
pnpm --filter api exec prisma generate
pnpm --filter api exec prisma migrate dev

# Docker dev infrastructure
cd docker && docker compose up -d                  # postgres, redis, qdrant
cd docker && docker compose --profile auth up -d   # + keycloak (:8080)
```

### Mandatory Pre-Completion Checks
Before finishing any task:
1. If `packages/shared-types` changed: `pnpm --filter @aios/shared-types build`
2. Backend changes: `pnpm --filter api lint`, `pnpm --filter api test`, and `pnpm --filter api build`
3. Frontend changes: `pnpm --filter web lint` and `pnpm --filter web build`

---

## 3. Code Style: ESLint, Prettier & TypeScript Rules

### 3.1 Prettier (`apps/api/.prettierrc`)
- `singleQuote: true`
- `trailingComma: "all"`
- `endOfLine: "auto"` (enforced via `eslint-plugin-prettier/recommended` as an ESLint **error** in `apps/api`).
- Note: `apps/web` currently has ESLint only (no Prettier config/script).

### 3.2 ESLint — API (`apps/api/eslint.config.mjs`)
- Flat config extending `@eslint/js` recommended, `typescript-eslint` `recommendedTypeChecked` (`projectService: true`), and `eslint-plugin-prettier/recommended`.
- `sourceType: 'commonjs'`, globals: `globals.node` + `globals.jest`.
- Rule overrides:
  - `@typescript-eslint/no-explicit-any`: `'off'` (still avoid `any` in new domain/core code; use `unknown` + narrowing).
  - `@typescript-eslint/no-floating-promises`: `'warn'` (always `await`, `return`, or explicitly handle promises).
  - `@typescript-eslint/no-unsafe-argument`: `'warn'` (avoid unsafe `any` arguments).
  - `prettier/prettier`: `['error', { endOfLine: 'auto' }]`.

### 3.3 ESLint — Web (`apps/web/eslint.config.js`)
- Flat config for `**/*.{ts,tsx}` extending `@eslint/js` recommended, `typescript-eslint` recommended, `react-hooks` (`flat.recommended`), and `react-refresh` (`vite`).
- Globals: `globals.browser`; ignores `dist`.
- Follow `react-refresh` rules (export React components cleanly; avoid mixing incompatible exports in component files) and React Hooks dependency rules.

### 3.4 TypeScript Compiler Settings
- **API (`apps/api/tsconfig.json`):** `target: "ES2023"`, `module: "nodenext"`, `moduleResolution: "nodenext"`, `strictNullChecks: true`, `isolatedModules: true`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`.
  - Path aliases configured in `tsconfig.json` and Jest `moduleNameMapper`: `@/*`, `@core/*`, `@infrastructure/*`, `@modules/*`.
  - Keep `isolatedModules: true` compatibility: use `import type` when importing interfaces/types used only in type positions (especially with `emitDecoratorMetadata` in NestJS controllers/services).
- **Web (`apps/web/tsconfig.app.json`):** `target: "es2023"`, `module: "esnext"`, `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`, `erasableSyntaxOnly: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`.
  - Because `verbatimModuleSyntax` and `erasableSyntaxOnly` are enabled: always use `import type` for type-only imports, and avoid non-erasable TypeScript syntax (e.g., runtime `enum` declarations or constructor parameter properties).
- **Shared Types (`packages/shared-types/tsconfig.json`):** `strict: true`, `target: "ES2022"`, `module: "CommonJS"`, `declaration: true`. Re-export all public types from `packages/shared-types/src/index.ts`.

### 3.5 Comments & Documentation Convention
- Preserve existing comments and docstrings.
- Project docstrings, architectural comments, and module docs (`apps/api/src/modules/<module>/docs/`) are written primarily in clear Vietnamese with standard English technical terminology.

---

## 4. Technical & Architectural Rules

AIOS strictly follows a **4-layer unidirectional dependency architecture** inheriting 4 core principles from Caremate:

```text
Clients (apps/web, apps/desktop)
   └──> Business Modules (apps/api/src/modules/*)
           └──> Core Contracts (apps/api/src/core/*)
                   <── Infrastructure Adapters (apps/api/src/infrastructure/*)
```

### 4.1 Pure Core Contracts (`apps/api/src/core/`)
- `core/` defines pure TypeScript interfaces and primitives (`AgentExecutionContext`, `ContextBuilder`, `AIOSHookHandler`, `HookRegistry`, `ILLMClient`, `IEmbeddingClient`, `IJobQueue`, `ToolDefinition`, `ITracer`, `ILogger`).
- **Rule:** `core/` must NEVER depend on external provider SDKs (`openai`, `@google/generative-ai`, `ollama`, `@qdrant/qdrant-js`, `bullmq`, `express`) or any `modules/*` implementation.

### 4.2 Anti-Corruption Layer (ACL)
- Business modules (`src/modules/*`) must NEVER import LLM SDKs, Qdrant SDK, Redis/BullMQ directly.
- Always inject Core/Gateway abstractions: `LLMGatewayService`, `EmbeddingGatewayService`, `IVectorStore`, `IJobQueue`, `LocalStorageService`.
- Infrastructure swapping (e.g., `VECTOR_STORE_PROVIDER=pgvector|qdrant`, `KNOWLEDGE_PROCESSING_MODE=sync|queue`, `LLM_PROVIDER`, `EMBEDDING_PROVIDER`) must work via environment variables without changing business code.

### 4.3 Immutable Context Pattern (`AgentExecutionContext`)
- `AgentExecutionContext` (`src/core/context/agent-context.interface.ts`) is strictly `readonly` and carries `readonly userId: string` at the root.
- **Rule:** NEVER mutate `ctx` or nested properties (`ctx.prefetch`, `ctx.context`, `ctx.metadata`) in place.
- Always create or derive a new context via `ContextBuilder.create()` or `ContextBuilder.from(ctx)...build()`.

### 4.4 Lifecycle Hooks (`AIOSHookHandler`)
- `onBeforePromptBuild?(ctx)` is an **immutable pipeline**: receives `ctx`, returns a new enriched `Promise<AgentExecutionContext>`.
- `onBeforeToolExecution?(toolName, input, ctx)` acts as the **Policy Guard**: must return `Promise<boolean>` and enforce ownership (`ctx.userId`) and safety before any tool executes.
- `onAfterToolExecution?` and `onAfterCompletion?` handle reflection, telemetry, latency, and token accounting (`AgentRun`).

### 4.5 Standard Backend Module Structure (`apps/api/src/modules/<name>/`)
Every feature module follows this layout:
- `<name>.module.ts` — DI wiring and exports.
- `<name>.controller.ts` — HTTP/SSE routes, `@CurrentUser()`, `ParseUUIDPipe({ version: '4' })` on UUID params.
- `<name>.service.ts` — Business rules, DTO validation, orchestration, `ContextBuilder` / Hook execution.
- `<name>.repository.ts` — **The ONLY layer in the module allowed to access `PrismaService`**. Must enforce `userId` and `deletedAt: null`.
- `dto/*.dto.ts` — Pure TypeScript classes (`!` / `?`).
- `entities/*.entity.ts` — Domain entity wrappers (with `fromPrisma(...)` mappers).
- `*.spec.ts` — Colocated Jest unit tests.
- `docs/` — Module business & technical documentation.

### 4.6 DTOs & Validation (Important Codebase Convention)
- **`class-validator` and `class-transformer` are NOT installed** in `apps/api/package.json`.
- Keep DTOs as pure TypeScript classes (using `@nestjs/mapped-types` when deriving `PartialType`/`PickType`/`OmitType`).
- Perform explicit input validation in the **Service** layer (throwing `BadRequestException` with clear messages) and use Nest built-in pipes like `ParseUUIDPipe({ version: '4' })` on route parameters.

### 4.7 Jest Testing & ESM Stubs Gotcha
- `@nestjs/config` v12 and `@nestjs/mapped-types` are ESM-only packages, while Jest runs in CommonJS mode.
- `apps/api/package.json` maps both via `jest.moduleNameMapper` to `test/stubs/config.stub.ts` and `test/stubs/mapped-types.stub.ts`.
- **Rule:** Do NOT delete or bypass these stubs unless migrating the entire Jest setup to ESM. Unit tests (`*.spec.ts`) must mock external dependencies (`PrismaService`, LLM/Embedding gateways, `RedisService`, `IJobQueue`) and pass offline without Docker/DB/LLM keys.

### 4.8 Atomic Transactions, SSE Safety & Graceful Degradation
- **Transactions:** Multi-table writes or cascading soft-deletes (e.g., `Conversation` + initial `Message` + `AgentRun` + `MessageDocument`, or soft-deleting `Conversation` + child `Message`s) must execute inside `this.prisma.$transaction(...)`.
- **SSE Streaming (`POST /chat/stream`):**
  1. Complete all DTO validation, IDOR/ownership checks, and DB turn initialization **BEFORE** setting `Content-Type: text/event-stream` headers (so 400/404 errors return normal JSON HTTP responses).
  2. Set anti-buffering headers: `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`.
  3. Wire `AbortController` to `req.on('close')` and transition `AgentRun.status` cleanly (`running` -> `completed` | `failed` | `cancelled` — never leave zombie `running` runs).
  4. Fallback to `TokenCounterService` if a streaming LLM provider omits token usage.
- **No Double User Message:** When loading recent chat history in a turn, always exclude the newly persisted current user `message.id` (`excludeMessageId`).
- **Graceful Degradation:** In chat context enrichment, prefetch Memory and RAG chunks in parallel (`Promise.allSettled`); if Memory or Vector Store fails, log a warning and fall back to `[]` so chat still responds.

---

## 5. Business, Security & Data Rules (Mandatory)

### 5.1 Zero-Trust Authentication & `@CurrentUser()`
- `AIOSAuthGuard` (`src/modules/auth/guards/aios-auth.guard.ts`) is registered globally as `APP_GUARD`.
- Supports `AUTH_MODE=keycloak` (JWKS signature, `iss`, `aud`, `exp`, `nbf` verification via `node:crypto`, auto-upserts `User` by `sub`) and `AUTH_MODE=dev_bypass` (resolves `DEFAULT_LOCAL_USER_ID = '00000000-0000-abcd-0000-000000000001'`).
- **Rule:** NEVER accept `userId` from request `body`, `query`, or unverified headers. Always inject `@CurrentUser() user: AuthenticatedUser` in Controllers and pass `user.id` down.
- Only use `@Public()` for explicitly public endpoints (e.g., health checks, pairing handshake).
- Never store passwords in AIOS; never add admin roles in MVP; never silently auto-assign orphaned/dev records to a Keycloak user (claiming local data requires explicit user action via `POST /auth/claim-local-data`).

### 5.2 Strict Multi-User Ownership Isolation (Anti-IDOR)
- Root aggregates carry `userId`: `Conversation`, `Document`, `MemoryRecord`, `Plan`, `Workflow`.
- Child entities inherit ownership through their parent: `Message`, `MessageDocument`, `AgentSession`, `AgentRun`, `ToolExecution`, `DocumentChunk`, `WorkflowStep`, `Task`.
- **Rule:** Every repository `find*`, `list*`, `count*`, `update*`, `delete*`, and vector `searchSimilarity` MUST filter by `userId` (either directly or via parent relation `parent: { userId, deletedAt: null }`).
- Always validate ownership of referenced IDs (e.g., `conversationId`, `documentIds`, `planId`, `parentTaskId`) before associating or reading them.

### 5.3 Soft Delete (Tombstone) & E2EE Sync Readiness
- Syncable tables (`Conversation`, `Message`, `Document`, `DocumentChunk`, `MemoryRecord`, `Plan`, `Task`, `Workflow`) include `version Int @default(1)`, `contentHash String?`, and `deletedAt DateTime?`.
- **Rule 1:** Every normal read/list/search query MUST include `deletedAt: null`.
- **Rule 2:** Deletes on syncable entities MUST be Soft Deletes (`deletedAt: new Date()`) and increment `version` (`version: { increment: 1 }`) so Tombstones propagate cleanly during E2EE Sync.
- **Rule 3:** `MemoryRecord` uniqueness is `@@unique([userId, key])`. On upsert, update value/category, increment `version`, and reset `deletedAt: null`.

### 5.4 Vector Embeddings & Local Storage
- Vector dimension is standardized at **768** (`Unsupported("vector(768)")?` in `document_chunks`), alongside `embeddingModel` for Smart Vector Sync (`Float32Array` binary compression in E2EE Sync Envelopes).
- Uploaded source files are stored via `LocalStorageService` under `LOCAL_STORAGE_PATH` (and in Desktop under OS `userData` scoped by `userId`). Never use email addresses in filesystem paths, and never expose raw host absolute paths to clients.

### 5.5 Companion, Desktop & Privacy Boundaries
- Local Companion binds ONLY to `127.0.0.1`, implements Browser Private Network Access (`Access-Control-Allow-Private-Network: true`), and requires scoped pairing tokens. CORS is origin-filtering only, never authentication.
- Electron Renderer must NOT enable `nodeIntegration` or access filesystem/DB directly; IPC is strictly allowlisted for sidecar lifecycle and OS integration.
- Never hardcode API keys/secrets in source code or web bundles. Never log sensitive plaintext prompts, documents, or tokens in default logs.

---

## 6. Playbook for Starting a New Task

When picking up a task in a fresh conversation:
1. **Orient:** Check `docs/task_list.md` to see what is completed and what is next (currently **Phase 4 / Sprint 3: Task 3.1 Planner Module**, followed by Tools & MCP). Read relevant docs in `docs/modules_rule/` or `apps/api/src/modules/<mod>/docs/`.
2. **Schema & Shared Contracts First:**
   - Check `apps/api/prisma/schema.prisma` before changing data models; ensure `userId`, `version`, `contentHash`, `deletedAt` rules are respected.
   - Define shared DTO interfaces/enums in `packages/shared-types/src/` and run `pnpm --filter @aios/shared-types build`.
3. **Implement Cleanly:**
   - Wire NestJS module (`controller` -> `service` -> `repository`), keeping Prisma inside `repository.ts` and SDKs behind `core/` + `infrastructure/`.
   - Enforce `@CurrentUser()`, `userId` isolation, `deletedAt: null`, `version` increment, and service-level validation.
4. **Test Thoroughly:**
   - Add `*.spec.ts` unit tests for controller, service, and repository covering happy paths, validation errors, soft-delete tombstones, and **cross-user isolation (IDOR rejection)**.
5. **Verify & Update Docs:**
   - Run `lint`, `test`, and `build` for all affected workspaces (`shared-types`, `api`, `web`).
   - Update `docs/task_list.md` and module docs (`business`/`technical`) if completing a milestone task.
