# Plan: Web, Desktop và Local Companion

## Mục tiêu kiến trúc

Phát triển AIOS thành ba thành phần phối hợp:

1. Web app được host (HTTPS), đồng thời là cổng quản lý tài khoản và tải desktop app.
2. Desktop app đóng gói giao diện hiện có cùng local companion runtime.
3. Local companion agent được cài riêng để web app truy cập dữ liệu trên máy người dùng. Desktop app dùng cùng NestJS companion runtime dưới dạng sidecar.

Hai client dùng chung local data plane. Trên Desktop/Local Companion, toàn bộ dữ liệu quan hệ, canonical chunks, vector index và job queue được hợp nhất trong **PGlite (WASM Embedded Postgres) tích hợp sẵn extension `pgvector`** chạy ngay trong tiến trình NestJS (Zero-daemon, không cần cài đặt PostgreSQL server, Qdrant hay Redis riêng). Keycloak quản lý danh tính, Google là identity provider thông qua Keycloak. Dữ liệu đồng bộ giữa thiết bị dưới dạng mã hóa đầu cuối (E2EE Sync Envelopes). Không có vai trò admin trong phạm vi MVP. Study nằm ngoài phạm vi.

## Các giai đoạn

### Giai đoạn 1: Ranh giới kiến trúc, Xác thực và Browser PNA

1. Chốt Electron cho desktop. Host web SPA/download portal riêng; đóng gói React UI hiện tại trong Electron. Electron Main chịu trách nhiệm khởi chạy, cấp phát port động cho HTTP API (nếu port mặc định bận), giám sát và dừng NestJS sidecar; sidecar chỉ bind loopback (`127.0.0.1`). Desktop renderer và web app đều gọi cùng local HTTP API để dùng domain logic và dữ liệu Knowledge. IPC chỉ dùng giữa Electron Main/Renderer cho lifecycle/status của sidecar và tích hợp OS, không dùng làm API lưu trữ hay nhân đôi nghiệp vụ. Người dùng web cần companion đang chạy để dùng các chức năng AI/Knowledge trên dữ liệu local. Khi chưa có agent, web vẫn dùng được để đăng nhập, quản lý tài khoản, tải desktop và xem trạng thái sync.
2. Dùng Keycloak làm identity authority và cấu hình Google làm external IdP. Dùng OIDC Authorization Code + PKCE: đăng nhập qua system browser/deep link (`aios://auth/callback`) cho desktop và redirect cho web. Xác thực token local bằng JWKS, issuer, audience và scopes. Dùng luồng xác minh email có sẵn của Keycloak khi đăng ký; không triển khai custom OTP số trong MVP.
3. Bảo vệ local companion & Vượt rào cản trình duyệt:
   - Chỉ bind `127.0.0.1`, giới hạn origin, kiểm tra origin/CSRF, pairing challenge dùng một lần do người dùng chủ động khởi tạo, local access token thời hạn ngắn và có scope.
   - **Xử lý Browser Private Network Access (PNA):** Bổ sung middleware phản hồi header `Access-Control-Allow-Private-Network: true` cho các preflight request gọi từ HTTPS Web App xuống `http://127.0.0.1`.
   - **Chiến lược Fallback cho Safari/Brave:** Vì Safari và Brave (khi bật Shield) có thể chặn cứng Mixed Content từ HTTPS gọi xuống HTTP localhost, Web UI phải có cơ chế phát hiện lỗi kết nối PNA để hướng dẫn người dùng tắt chặn trên domain AIOS hoặc chuyển sang mở trực tiếp ứng dụng Electron Desktop.
   - Electron Main không expose Node integration cho renderer; IPC handlers phải giới hạn command và validate input. Không mở remote tunnel không xác thực; không xem CORS là cơ chế xác thực.

### Giai đoạn 2: User, Auth Module và Chuẩn hóa Schema cho Sync (Ưu tiên thực hiện ngay trước Task 2.3)

4. Thêm `User` projection local và triển khai **`AuthModule` (`modules/auth`)** ngay tại nền tảng:
   - Bảng `User` gồm UUID nội bộ, `keycloakSubject` duy nhất (nullable cho tài khoản local mặc định lúc dev), email, display name, trạng thái xác minh email và timestamps. Không lưu mật khẩu, không thêm role admin.
   - Triển khai `AIOSAuthGuard` (Dual-Mode qua biến môi trường `AUTH_MODE=keycloak | dev_bypass`) và `@CurrentUser()` decorator. Ở chế độ `keycloak`, xác thực JWT qua JWKS và tự động upsert `User` từ `sub`. Ở chế độ `dev_bypass` (dùng khi phát triển các module trước khi bật Keycloak Server), tự động resolve một `Default Local User` đã seed sẵn; tuyệt đối không tin `userId` gửi từ body/query của client.
   - Đưa `readonly userId: string` vào gốc của `AgentExecutionContext` và đổi chữ ký `AIOSHookHandler.onBeforePromptBuild` sang trả về `Promise<AgentExecutionContext>` để đảm bảo tính bất biến thực sự (Immutable Pipeline).
5. Cập nhật Prisma ERD/schema local với ownership và các trường phục vụ E2EE Sync ngay từ đầu:
   - Thêm ownership (`userId`) trên các aggregate gốc (`Document`, `Conversation`, `MemoryRecord`, `Plan`, `Workflow`) và enforce ở service/repository. Bản ghi con kế thừa ownership qua parent. Đổi unique memory thành `(userId, key)`.
   - Thêm các trường đồng bộ vào các bảng cốt lõi: `version Int @default(1)`, `contentHash String?`, và `deletedAt DateTime?` (Soft-delete làm **Tombstone** để đồng bộ trạng thái xóa giữa các thiết bị).
   - Bổ sung metadata `embeddingModel String?` vào `Document` / `DocumentChunk` (giữ cột `embedding vector(768)` cho `pgvector` của Postgres/PGlite) để phục vụ cơ chế Smart Vector Sync.
6. Tạo migration và quy trình claim/import rõ ràng (`POST /auth/claim-local-data`) cho dữ liệu cũ được tạo dưới `Default Local User`. Không tự động gán mù quáng các record chưa có owner vào tài khoản bất kỳ. Kiểm tra rollback và migration trên bản sao dữ liệu hiện có.

### Giai đoạn 3: Local Companion và Desktop (Kiến trúc PGlite + `pgvector` Zero-Daemon)

7. **Đóng gói Local Data Plane Siêu Gọn Nhẹ với PGlite + `pgvector` (Không Daemon, Không Redis):**
   - Lưu file gốc và thư mục dữ liệu DB dưới thư mục dữ liệu ứng dụng của hệ điều hành (Electron `app.getPath('userData')`), trong thư mục profile riêng theo `userId`; không lưu trong thư mục cài đặt, không dùng email làm path và không expose absolute path cho client.
   - **Sử dụng PGlite + bundled `pgvector` làm Local Data Engine:** Thay vì đóng gói tiến trình PostgreSQL server, Qdrant binary và Redis riêng biệt dễ gây xung đột port và lỗi cài đặt trên Windows/macOS, NestJS sidecar nhúng trực tiếp `@electric-sql/pglite` (bật extension `vector`) qua `@prisma/adapter-pglite` và dùng `PgVectorAdapter`. Toàn bộ dữ liệu quan hệ, canonical chunks và vector index HNSW nằm gọn trong một thư mục PGlite duy nhất.
   - **Loại bỏ phụ thuộc Redis trên Desktop:** Trừu tượng hóa hàng đợi qua interface `IJobQueue` ở tầng Core. Trên Desktop, sử dụng `PgLiteQueueAdapter` (lưu trạng thái job trong bảng SQL của PGlite) thay cho BullMQ/Redis.
8. Tái sử dụng Knowledge service/adapters trong NestJS sidecar; thêm file API có xác thực (`@CurrentUser()`), retrieval theo owner (`userId`) kèm lọc `deletedAt: null`, soft-delete (tombstone) kèm cleanup vật lý và cơ chế đồng bộ nhất quán giữa file, chunk và vector khi reindex/recovery. Electron Main quản lý sidecar readiness, crash/restart và shutdown sạch. Companion quản lý local API secrets qua OS Keychain; không nhúng provider credential trong web assets.
9. Đóng gói desktop, quản lý lifecycle sidecar, deep-link login, ký installer/update channel, download link theo OS, checksum và version metadata. Desktop renderer gọi cùng local API như web client; IPC dành cho OS integration và điều khiển Main process. Website vẫn là web client thực sự khi companion được cài và chạy.

### Giai đoạn 4: Encrypted Sync Đầu-Cuối (Sync Envelope & Smart Vector Sync)

10. Thêm ranh giới riêng cho cloud Sync API/object storage; không biến Knowledge API hiện tại thành dịch vụ cloud lưu plaintext. Client mã hóa payload bằng end-to-end vault key (AES-256-GCM) trước khi upload theo chuẩn **`EncryptedSyncItem` (Sync Envelope)** gồm: `id` (UUID), `userId`, `entityType`, `version`, `isDeleted` (Tombstone), `updatedAt`, `ciphertext`, `iv`, và `authTag`. Cloud không nhận plaintext hoặc khóa giải mã. Xác thực request sync bằng Keycloak identity và phân quyền vault namespace theo token subject.
11. Dùng recovery key do người dùng giữ để bọc/khôi phục vault key trên thiết bị mới. Định nghĩa rotation, đăng ký/thu hồi thiết bị, xử lý mất thiết bị và tái tạo recovery key. Nếu mất cả vault key lẫn recovery key thì ciphertext đã sync không thể giải mã; cần thông báo rõ cho người dùng.
12. **Đồng bộ Toàn diện & Cơ chế Smart Vector Sync:**
    - Đồng bộ toàn bộ encrypted canonical documents, chunks, manifests, tombstones (`deletedAt`), conversations/messages, memory records và plans/tasks để đảm bảo trải nghiệm đa thiết bị đầy đủ.
    - **Smart Vector Sync (Tránh tốn phí Re-embedding):** Không đồng bộ cấu trúc chỉ mục HNSW của `pgvector`. Tuy nhiên, nếu chunk được tạo bởi Cloud Embedding trả phí (OpenAI/Gemini), client hỗ trợ nén nhị phân mảng `Float32Array` vector (768 chiều) kèm `embeddingModel` và mã hóa E2EE gửi kèm Sync Envelope. Khi đồng bộ sang thiết bị thứ 2, sau khi giải mã, máy mới ghi thẳng mảng vector vào cột `embedding` của PGlite local mà không cần gọi lại API Embedding. Nếu dùng Local Ollama hoặc đổi model, máy mới tự rebuild vector từ canonical text.
    - Thêm versioned manifests, content hashes, optimistic concurrency và conflict resolution; thử nghiệm multipart/resume cho file lớn và đồng bộ xóa. Không cung cấp semantic search phía server trên dữ liệu E2E-encrypted.
13. Xem hosted LLM là ranh giới riêng tư riêng: khi local agent gửi context plaintext đã truy xuất đến model hosted, nội dung rời khỏi thiết bị. Công khai lựa chọn provider và hỗ trợ local-model mode (Ollama) khi có thể.

### Giai đoạn 5: Tài liệu và Kiểm chứng

14. Cập nhật master ERD để thể hiện deployment/data boundaries, bảng `User`, các trường `userId`, `version`, `deletedAt` (tombstone) và phân biệt local relational ownership (trên PGlite/Postgres) với cloud sync metadata. Cập nhật Knowledge business/technical docs, auth/setup docs, cài đặt desktop, backup/recovery và privacy disclosures.
15. Validate/generate Prisma và chạy API unit/e2e tests. Bổ sung kiểm thử cho `AuthModule` (token hợp lệ/invalid/expired/sai audience và `dev_bypass`), truy cập chéo user, origin không an toàn, PNA preflight headers, pairing hết hạn/replay, PGlite + `pgvector` persistence, encrypted payload, sync conflict/tombstone/device revoke và khôi phục recovery key. Kiểm tra thủ công web không agent, web có agent (trên Chrome, Safari, Brave), desktop, hai user trên một máy, hai thiết bị cùng user, reinstall/restart và local index rebuild.

## File và phạm vi liên quan

- `docs/diagrams/erd.md`: sửa ERD hiện tại để thêm `User`, `userId`, `version`, `deletedAt` và phân biệt local PGlite data plane với cloud identity/sync plane.
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/`: thêm `User`, ownership, sync fields (`version`, `contentHash`, `deletedAt`, `embeddingModel`) và migration an toàn ngay ở Task 2.2.5.
- `apps/api/src/core/`: thêm `userId` vào `AgentExecutionContext`, đổi `onBeforePromptBuild` sang Immutable Pipeline, thêm `IJobQueue`.
- `apps/api/src/modules/auth/`: triển khai `AuthModule`, `AIOSAuthGuard` (`keycloak` + `dev_bypass`), `KeycloakJwtVerifier`, `@CurrentUser()`, pairing token và data claiming ngay ở Task 2.2.6.
- `apps/api/src/app.module.ts`, `apps/api/src/main.ts`: đăng ký Global Auth Guard, loopback binding, PNA middleware và security policy.
- `apps/api/src/modules/knowledge/`, `apps/api/src/modules/memory/`: áp dụng `@CurrentUser()`, ownership local, soft-delete tombstones, file/retrieval APIs, delete/reindex consistency.
- `apps/api/src/infrastructure/database/prisma.service.ts`: hỗ trợ khởi tạo qua `@prisma/adapter-pglite` (kèm extension `vector`) cho Desktop bên cạnh PostgreSQL chuẩn cho Dev.
- `apps/api/src/infrastructure/vector-store/` và `apps/api/src/infrastructure/queue/`: dùng `PgVectorAdapter` và `PgLiteQueueAdapter` làm mặc định trên Desktop.
- `apps/web/`: web client, pairing/status của companion, PNA fallback UI, account views và desktop download portal.
- `apps/desktop/` (package mới): Electron Main/Renderer, preload bridge giới hạn, sidecar lifecycle, callback và signed installers.
- Sync service/deployment mới: encrypted object/manifests API (`EncryptedSyncItem`), account-scoped ACL và retention.

## Quyết định hiện tại

- Electron là desktop shell. Electron Main khởi chạy NestJS sidecar; desktop renderer và web app gọi chung local API (có hỗ trợ PNA headers). IPC chỉ phục vụ sidecar lifecycle/status và OS integration. Hosted web app sử dụng companion đã cài/chạy cho AI/Knowledge local và cung cấp tải desktop. Không có companion thì web chỉ hỗ trợ login/account/download/sync status, không xử lý local-data.
- Keycloak là identity authority; Google login đi qua Keycloak. AIOS không lưu mật khẩu và không có admin role. Xây dựng `AuthModule` hỗ trợ Dual-Mode (`keycloak` và `dev_bypass`) ngay trước khi làm `ChatModule` (Task 2.3) để thống nhất `@CurrentUser()` và `userId` trên toàn hệ thống.
- **Chọn PGlite (WASM Embedded Postgres) + bundled `pgvector` + SQL Queue cho local data plane trên Desktop (Zero-daemon):** Lưu trữ đồng nhất metadata, canonical chunks, vector index (`vector(768)`) và job queue ngay trong một thư mục PGlite, loại bỏ hoàn toàn việc phải cài đặt PostgreSQL daemon, Qdrant binary hay Redis trên máy người dùng. Môi trường Dev vẫn có thể dùng Docker (Postgres/Qdrant/BullMQ) qua hệ thống Adapter.
- Chọn encrypted sync toàn diện (Documents, Chunks, Conversations, Memory, Plans) giữa các thiết bị qua cấu trúc `EncryptedSyncItem` và recovery key do user giữ; hỗ trợ Smart Vector Sync (đồng bộ mảng raw vector đã mã hóa cho Cloud Embedding) để tránh tốn phí re-embedding trên thiết bị mới.
- Study nằm ngoài phạm vi; khảo sát workspace hiện tại không tìm thấy Study module.
- Keycloak và sync infrastructure ở remote. File/chunks/vectors local ở trạng thái lưu trữ trong thư mục profile của PGlite/userData nhưng bản mã được lưu remote; hosted LLM có thể nhận chunks plaintext đã được truy xuất.

## Các điểm cần quyết định tiếp

1. Chốt cơ chế backup/restore thư mục PGlite an toàn (tránh copy file khi đang có transaction ghi) và tự động chạy Prisma schema migration khi nâng cấp phiên bản ứng dụng Desktop.
2. Định nghĩa chính sách dọn dẹp vật lý (Garbage Collection / Compaction) cho các bản ghi Tombstone (`deletedAt != null`) sau một khoảng thời gian (ví dụ: 30 ngày) để tránh phình to thư mục PGlite local và Cloud Sync storage.
3. Định nghĩa retention/quota của ciphertext trên Cloud Sync API, bao gồm object đã xóa và account deletion, trước khi mở sync cho người dùng.