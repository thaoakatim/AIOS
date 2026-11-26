# 🤖 AIOS — Personal AI Operating System

> **Personal Chief of Staff (Trợ lý điều hành cá nhân)**  
> *Được xây dựng theo phong cách Modular Monolith & Clean Architecture, kế thừa các nguyên lý trừu tượng hóa cốt lõi, Context Pattern và Lifecycle Hooks.*

---

## 🌟 Điểm Nhấn Kiến Trúc & Công Nghệ

* **Local-First & Zero-Daemon trên Desktop:**  
  Sử dụng **PGlite (WASM Embedded Postgres)** tích hợp sẵn extension **`pgvector`** chạy trực tiếp bên trong tiến trình NestJS sidecar. Lưu trữ đồng nhất cả dữ liệu quan hệ, canonical chunks, vector index HNSW và local job queue (`IJobQueue`) vào một thư mục `userData` duy nhất—hoàn toàn không cần cài đặt PostgreSQL server, Qdrant binary hay Redis daemon.
* **Product Topology (Web, Desktop & Local Companion):**  
  * **Web App (React/Vite):** Chạy trên trình duyệt (HTTPS), kết nối an toàn với Local Companion qua Browser Private Network Access (PNA) và mã Pairing có scope.
  * **Desktop App (Electron):** Đóng gói UI, quản lý vòng đời sidecar và cấp phát port động (`Dynamic Port Allocation`).
  * **NestJS Local Companion:** Runtime xử lý nghiệp vụ, chỉ bind loopback (`127.0.0.1`).
* **Kế thừa 4 Nguyên tắc Cốt lõi:**  
  1. *Pure Core Contracts:* Tầng `core/` chỉ định nghĩa Pure TypeScript Interfaces (`ILLMClient`, `IVectorStore`, `IJobQueue`...), độc lập 100% với SDK bên ngoài.
  2. *Immutable Context Object:* `AgentExecutionContext` bất biến mang `userId` ngay tại gốc để đảm bảo Data Isolation.
  3. *AIOS Lifecycle Hooks:* Interceptors đánh chặn (`onBeforePromptBuild` pipeline bất biến, `onBeforeToolExecution` Policy Guard, `onAfterCompletion` telemetry).
  4. *Anti-Corruption Layer (ACL):* Cô lập hoàn toàn LLM Gateway, Vector Store và Queue.
* **Định danh & Đồng bộ Mã hóa Đầu-Cuối (E2EE Sync):**  
  * **Keycloak:** Quản lý danh tính qua OIDC PKCE & Google IdP (AIOS không lưu mật khẩu).
  * **E2EE Sync Envelopes:** Dữ liệu đồng bộ qua ciphertext AES-256-GCM, máy chủ đám mây không thể đọc plaintext (Zero-Knowledge).
  * **Smart Vector Sync:** Hỗ trợ nén nhị phân vector nhúng (`Float32Array`) để đồng bộ sang thiết bị mới mà không tốn chi phí gọi lại Embedding API.

---

## 🏗️ Cấu Trúc Monorepo (`pnpm workspace`)

```text
AIOS/
├── apps/
│   ├── api/                             # NestJS Backend / Local Companion
│   │   ├── src/
│   │   │   ├── core/                    # Core Contracts: Context, Hooks, LLM Gateway, IJobQueue
│   │   │   ├── modules/                 # Business Modules: Auth, Chat, Knowledge, Memory, Planner, Workflow, Agents, Tools, Sync
│   │   │   └── infrastructure/          # Adapters: PGlite, Postgres, PgVector, Qdrant, BullMQ, LLM Providers
│   │   └── prisma/                      # Prisma Schema & Migrations (Multi-user ownership & Sync fields)
│   ├── web/                             # React 19 + Vite Frontend (Chat, Knowledge Hub, Kanban Planner)
│   └── desktop/                         # Electron Main, Renderer, Preload & Packaging
│
├── docker/                              # Môi trường Dev truyền thống (PostgreSQL, Qdrant, Redis)
│   └── docker-compose.yml
│
├── packages/                            # Thư viện dùng chung
│   └── shared-types/                    # DTOs, Enums, Contracts, Sync Envelopes
│
├── docs/                                # Toàn bộ tài liệu thiết kế & phân tích hệ thống
└── README.md
```

---

## 🚀 Khởi Chạy Dự Án (Quickstart)

### 1. Cài đặt Dependencies
Dự án sử dụng `pnpm` (khuyến nghị Node.js 20+ và pnpm 10+):
```bash
pnpm install
```

### 2. Môi trường Development (Docker Stack)
Khởi động hạ tầng phát triển (PostgreSQL, Qdrant, Redis):
```bash
cd docker
docker compose up -d
cd ..
```

### 3. Cấu hình Biến Môi trường
Sao chép file mẫu và cấu hình API Keys:
```bash
cp apps/api/.env.example apps/api/.env
```

### 4. Chạy Cơ sở Dữ liệu & Migrate
```bash
cd apps/api
pnpm exec prisma migrate dev
cd ../..
```

### 5. Khởi chạy Ứng dụng
Chạy đồng thời cả API và Web Client:
```bash
pnpm run dev
```
* **API Server:** `http://localhost:3000` (hoặc port động)
* **Web Client:** `http://localhost:5173`

---

## 📚 Bản Đồ Tài Liệu Kỹ Thuật (Documentation)

* 🏛️ **Kiến trúc Tổng thể:** [docs/architecture.md](file:///Users/thaonh21/AIOS/docs/architecture.md)
* 📋 **Master Tasklist:** [docs/task_list.md](file:///Users/thaonh21/AIOS/docs/task_list.md)
* 🧩 **Phân rã Module:** [docs/module-decomposition.md](file:///Users/thaonh21/AIOS/docs/module-decomposition.md)
* 🗺️ **Kế hoạch Web/Desktop/Companion:** [docs/plan/architecture-web-desktop-local-companion.md](file:///Users/thaonh21/AIOS/docs/plan/architecture-web-desktop-local-companion.md)
* 📊 **Sơ đồ Thực thể Quan hệ (ERD):** [docs/diagrams/erd.md](file:///Users/thaonh21/AIOS/docs/diagrams/erd.md)
* 📦 **Domain Model & Bounded Contexts:** [docs/diagrams/domain-model.md](file:///Users/thaonh21/AIOS/docs/diagrams/domain-model.md) | [docs/diagrams/bounded-context.md](file:///Users/thaonh21/AIOS/docs/diagrams/bounded-context.md)
* 🔄 **Luồng Yêu cầu (Request Flow):** [docs/request-flow.md](file:///Users/thaonh21/AIOS/docs/request-flow.md)
* 📐 **Component Diagram:** [docs/diagrams/component-diagram.md](file:///Users/thaonh21/AIOS/docs/diagrams/component-diagram.md)
* 📖 **Đặc tả Module Quy tắc:** [docs/modules_rule/knowledge-module.md](file:///Users/thaonh21/AIOS/docs/modules_rule/knowledge-module.md) | [docs/modules_rule/memory-module.md](file:///Users/thaonh21/AIOS/docs/modules_rule/memory-module.md)
