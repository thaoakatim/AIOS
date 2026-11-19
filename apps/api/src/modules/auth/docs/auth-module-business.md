# Auth Module — Tài liệu Nghiệp vụ (Business Document)

## 1. Mục tiêu Nghiệp vụ của Auth Module trong AIOS

Hệ điều hành AI cá nhân **AIOS (Personal AI Operating System)** được thiết kế để vừa phục vụ người dùng độc lập trên máy trạm cục bộ (**Local-First / Zero-Daemon Desktop**), vừa hỗ trợ triển khai trên môi trường Cloud / Multi-user với định danh tập trung (**Keycloak OIDC Single Sign-On**).

Module **Auth & Identity** giải quyết các bài toán nghiệp vụ trọng yếu:

1. **Bảo vệ quyền riêng tư & Cô lập dữ liệu đa người dùng (Multi-tenant Data Ownership):**
   - Mọi tri thức tải lên (Knowledge RAG), ký ức dài hạn (Memory), phiên hội thoại (Chat), kế hoạch (Planner) và quy trình tự động (Workflow) đều phải có chủ sở hữu hợp pháp (`userId`).
   - Ngăn chặn triệt để nguy cơ người dùng này truy cập, đọc trộm, chỉnh sửa hoặc tìm kiếm vector chéo vào dữ liệu của người dùng khác.

2. **Cơ chế xác thực linh hoạt theo ngữ cảnh vận hành (Dual-Mode Authentication):**
   - **Chế độ `keycloak` (Production / Staging / Dev Server):** Bắt buộc người dùng đăng nhập qua Keycloak OIDC (Google SSO, Email Verification), quản lý Access Token dạng Bearer JWT có chữ ký số mã hóa.
   - **Chế độ `dev_bypass` (Local Development / Zero-Daemon Desktop):** Tự động cấp quyền truy cập dưới định danh `Default Local User` mà không đòi hỏi phải dựng Keycloak server hay internet, giúp lập trình viên kiểm thử nhanh và phục vụ ứng dụng Desktop offline.

3. **Chống giả mạo định danh (Anti-Spoofing & Zero-Trust):**
   - Tuyệt đối không bao giờ tin cậy `userId` do client gửi lên qua request body, query params hay custom headers.
   - Định danh người dùng luôn luôn được trích xuất an toàn từ chữ ký số mật mã của JWT (ở chế độ Keycloak) hoặc do backend guard tự động resolve (ở chế độ dev bypass).

---

## 2. Mô hình Người dùng & Chiếu danh tính (Identity Projection)

### 2.1. Phân định ranh giới trách nhiệm giữa Keycloak và AIOS
AIOS áp dụng nguyên tắc **Federated Identity & Local Projection**:
- **Keycloak sở hữu Identity Provider (IdP):** Quản lý tài khoản, mật khẩu, đăng ký, email verification, social login (Google), multi-factor authentication (MFA), và cấp phát OIDC Access Token / Refresh Token.
- **AIOS không lưu mật khẩu:** Cơ sở dữ liệu AIOS không bao giờ lưu trữ hashed password, salt hay thông tin nhạy cảm về thông tin đăng nhập của người dùng.
- **Bảng `User` trong AIOS là một Local Projection:** Chỉ lưu trữ các trường tối thiểu cần thiết để làm khóa ngoại (`userId`) cho các aggregate nghiệp vụ:
  - `id` (UUIDv4): Khóa chính nội bộ của AIOS.
  - `keycloakSubject` (String, Unique Nullable): Ánh xạ 1:1 với claim `sub` trong JWT của Keycloak. Bằng `null` đối với Default Local User.
  - `email` (String): Địa chỉ email của người dùng.
  - `displayName` (String, Nullable): Tên hiển thị người dùng.
  - `emailVerified` (Boolean): Trạng thái xác thực email từ Keycloak.

```mermaid
flowchart LR
    subgraph Keycloak_Realm["Keycloak OIDC Realm"]
        UserAcc["Keycloak User Account (sub: 'kc-uuid-123', email, credentials)"]
        TokenIssuer["Token Issuer (JWKS RSA-SHA256)"]
        UserAcc --> TokenIssuer
    end

    subgraph AIOS_Backend["AIOS Core & Modules"]
        AuthGuard["AIOSAuthGuard"]
        UserRepo["UserRepository (Local Projection)"]
        UserRow["users table: id='aios-uuid', keycloakSubject='kc-uuid-123'"]
        BizModules["Memory, Knowledge, Chat, Planner, Workflow"]

        TokenIssuer -->|Bearer JWT| AuthGuard
        AuthGuard --> UserRepo
        UserRepo --> UserRow
        AuthGuard -->|@CurrentUser user.id| BizModules
    end
```

### 2.2. Cơ chế Tự động Đồng bộ hóa & Cấp phát tài khoản (Just-In-Time Provisioning)
Khi người dùng đăng nhập thành công trên Keycloak và gửi request đầu tiên kèm Access Token tới AIOS:
1. `KeycloakJwtVerifier` giải mã và kiểm tra tính hợp lệ của token.
2. `UserRepository.upsertFromKeycloak` tìm kiếm `keycloakSubject`:
   - **Đã tồn tại:** Cập nhật thông tin profile mới nhất (`email`, `displayName`, `emailVerified`).
   - **Chưa tồn tại nhưng trùng email với tài khoản local:** Liên kết `keycloakSubject` vào tài khoản cũ (Account Claiming).
   - **Người dùng hoàn toàn mới:** Tự động tạo bản ghi `User` mới trong bảng `users` ngay trong luồng xử lý (Just-In-Time Provisioning) mà không cần bước đăng ký riêng ở AIOS.

---

## 3. Quy tắc Nghiệp vụ về Phân quyền Sở hữu Dữ liệu (Ownership Rules)

Mọi module nghiệp vụ trong hệ điều hành AIOS bắt buộc phải tuân thủ các quy tắc sau:

| Module | Thực thể (Aggregate) | Ràng buộc nghiệp vụ đối với `userId` |
| :--- | :--- | :--- |
| **Auth** | `User` | Nguồn cội của mọi định danh. Không có role Admin can thiệp vào dữ liệu cá nhân của người khác. |
| **Memory** | `MemoryRecord` | Mỗi người dùng có namespace ký ức riêng. Khóa duy nhất theo user: `@@unique([userId, key])`. Ký ức user A không bao giờ lộ sang user B. |
| **Knowledge (RAG)** | `Document`, `DocumentChunk` | Tài liệu tải lên chỉ thuộc về user đó. Khi Semantic Search vector, kết quả trả về bắt buộc phải lọc theo `userId` và bỏ qua các tài liệu có `deletedAt != null`. |
| **Chat** | `Conversation`, `Message` | Phiên trò chuyện gắn liền với `userId`. `AgentExecutionContext` luôn mang `userId` để nạp đúng tri thức và ký ức của chính chủ. |
| **Planner** | `Plan`, `Task` | Kế hoạch và danh sách công việc cá nhân hóa của user. |
| **Workflow** | `Workflow`, `WorkflowStep` | Các quy trình tự động hóa cá nhân do user khởi chạy. |

---

## 4. Chế độ Vận hành Dual-Mode: `keycloak` vs `dev_bypass`

| Tiêu chí | Chế độ `keycloak` | Chế độ `dev_bypass` |
| :--- | :--- | :--- |
| **Mục đích** | Môi trường Production, Staging, Cloud Multi-tenant | Môi trường Local Dev, Unit/Integration Test, Desktop App offline |
| **Yêu cầu hạ tầng** | Cần Keycloak Server hoạt động và cấp phát JWKS | Hoàn toàn Zero-Daemon (không cần Keycloak, không cần internet) |
| **Cơ chế xác thực** | Yêu cầu header `Authorization: Bearer <JWT>` hợp lệ | Tự động phân giải `Default Local User` (`00000000-0000-0000-0000-000000000001`) |
| **Bảo mật** | Chữ ký số mã hóa RS256/ES256, kiểm tra thời hạn `exp`, `iss`, `aud` | Không yêu cầu token, cấm client giả mạo `userId` |
| **Cấu hình** | Biến môi trường `AUTH_MODE=keycloak` | Biến môi trường `AUTH_MODE=dev_bypass` |

---

## 5. Lộ trình Mở rộng Nghiệp vụ (Roadmap Alignment)

- **Task 2.2.6 (Hiện tại):** Hoàn thành Auth Module cốt lõi, Dual-Mode Guard, Decorators, và bảo vệ tức thời `MemoryModule` + `KnowledgeModule`.
- **Task 2.3 (Chat Module):** Sử dụng `@CurrentUser()` để gắn `userId` vào `Conversation`, `Message` và khởi tạo `AgentExecutionContext` bất biến.
- **Task 6.1 - 6.3 (Phase 7):** Kết nối Keycloak Realm thật, luồng OIDC PKCE, Data Claiming Flow và cơ chế Pairing bảo mật cho Desktop Local Companion.
