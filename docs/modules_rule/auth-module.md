# Auth Module — Quy chuẩn & Nguyên tắc Nghiệp vụ

## 1. Mục tiêu của Module

Module **Auth & Identity** là cánh cổng kiểm soát bảo mật và quản lý danh tính duy nhất trong hệ điều hành AIOS (Personal AI Operating System).

Nhiệm vụ trọng tâm:
1. **Xác thực danh tính (Authentication):** Kiểm tra và xác minh tính hợp lệ của người dùng thông qua Keycloak OIDC JWT Token hoặc tự động cấp quyền Local Dev User trong môi trường zero-daemon.
2. **Quản lý Quyền sở hữu (Multi-tenant Ownership):** Đóng vai trò là nguồn cội dữ liệu của thực thể `User`, cung cấp `userId` làm khóa ngoại bắt buộc cho mọi Aggregate gốc trong hệ thống: `Conversation`, `Document`, `MemoryRecord`, `Plan`, `Workflow`.
3. **Thiết lập Ngữ cảnh Bảo mật (Security Context):** Gắn thông tin người dùng đã xác thực (`AuthenticatedUser`) vào `request.user` để các module downstream sử dụng thống nhất thông qua decorator `@CurrentUser()`.

---

## 2. Vấn đề mà Module này Giải quyết

Trước khi triển khai Auth Module:
- Dữ liệu giữa các người dùng không có ranh giới rõ ràng; nguy cơ rò rỉ ký ức cá nhân hoặc tài liệu tri thức khi chạy trên môi trường đa người dùng.
- Hệ thống bị phụ thuộc hoặc dễ bị tấn công nếu cho phép client tự gửi `userId` trong request body/query (nguy cơ mạo danh người dùng khác).
- Việc chuyển đổi giữa môi trường phát triển cục bộ không có Keycloak (local offline / desktop) và môi trường Cloud có Keycloak gặp nhiều khó khăn.

Auth Module giải quyết triệt để các vấn đề trên nhờ cơ chế **Dual-Mode Guard** và **Zero-Trust Param Extraction**.

---

## 3. Khái niệm Chính & Lược đồ Dữ liệu

### 3.1. Prisma Model `User`
Thực thể `User` được lưu trong bảng `users`:
- `id` (UUIDv4): Khóa chính nội bộ trong AIOS.
- `keycloakSubject` (String, Unique Nullable): Ánh xạ 1:1 với claim `sub` trong JWT của Keycloak. Null khi chạy dev bypass.
- `email` (String): Email của người dùng.
- `displayName` (String, Nullable): Tên hiển thị.
- `emailVerified` (Boolean): Trạng thái xác thực email.
- `createdAt`, `updatedAt`: Timestamps.

### 3.2. Cấu trúc `AuthenticatedUser`
Đối tượng bất biến mang ngữ cảnh người dùng trong suốt vòng đời của một HTTP Request:
```typescript
export interface AuthenticatedUser {
  readonly id: string;               // UUID nội bộ AIOS
  readonly email: string;
  readonly displayName: string | null;
  readonly keycloakSubject: string | null;
  readonly emailVerified: boolean;
  readonly authMode: 'keycloak' | 'dev_bypass';
  readonly roles?: string[];
}
```

---

## 4. QUY TẮC BẮT BUỘC CHO TOÀN BỘ CÁC MODULE KHÁC (INTEGRATION RULES)

Mọi lập trình viên và subagent khi phát triển các module trong AIOS (`Memory`, `Knowledge`, `Chat`, `Planner`, `Tools`, `Workflow`) **BẮT BUỘC TUÂN THỦ 100% CÁC NGUYÊN TẮC SAU**:

### Rule 1: Tuyệt đối CẤM tin tưởng `userId` do Client gửi lên
- **KHÔNG BAO GIỜ** khai báo `userId` trong DTO nhận từ body hoặc query của request (ngoại trừ admin system nội bộ trong tương lai).
- Mọi thông tin định danh người dùng **BẮT BUỘC** phải được inject từ Decorator `@CurrentUser()`:
  ```typescript
  // ĐÚNG:
  @Post()
  create(
    @Body() dto: CreateItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user.id);
  }

  // SAI NGHIÊM TRỌNG:
  @Post()
  create(@Body() dto: CreateItemDto) {
    return this.service.create(dto.userId, dto); // LỖ HỔNG BẢO MẬT: Giả mạo userId!
  }
  ```

### Rule 2: Luôn cô lập dữ liệu theo `userId` ở tầng Repository
- Khi thực hiện truy vấn `findMany`, `findFirst`, `findUnique`, `count`, hay `searchSimilarity`, câu lệnh Prisma **BẮT BUỘC** phải kèm điều kiện `userId`:
  ```typescript
  // ĐÚNG:
  this.prisma.memoryRecord.findFirst({
    where: { userId, key, deletedAt: null },
  });

  // SAI:
  this.prisma.memoryRecord.findFirst({
    where: { key }, // Rò rỉ dữ liệu giữa các user!
  });
  ```

### Rule 3: Luôn kết hợp điều kiện lọc Xóa mềm (`deletedAt: null`)
- Tất cả các bảng dữ liệu cốt lõi đã được bổ sung trường `deletedAt`. Mọi truy vấn đọc dữ liệu hợp lệ phải lọc `where.deletedAt = null` để phục vụ cơ chế Tombstone / E2EE Sync.
- Khi người dùng xóa bản ghi, ưu tiên thực hiện **Soft Delete**:
  ```typescript
  this.prisma.item.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  ```

### Rule 4: Luôn truyền `userId` vào `AgentExecutionContext`
- Khi khởi tạo ngữ cảnh chạy của Agent (Chat Module, ReAct Engine, Workflow), trường `userId` tại gốc của `AgentExecutionContext` bắt buộc phải là `user.id`:
  ```typescript
  const ctx = ContextBuilder.create()
    .setExecutionId(randomUUID())
    .setUserId(user.id)
    .setSessionId(sessionId)
    .setQuery(userQuery)
    .build();
  ```

### Rule 5: Sử dụng `@Public()` có kiểm soát
- Mặc định, `AIOSAuthGuard` được cấu hình là `APP_GUARD` toàn cục, bảo vệ toàn bộ các endpoint.
- Chỉ gắn decorator `@Public()` cho các endpoint thực sự công khai (như Health-check `/health`, hoặc bước handshake của Desktop Pairing Flow).

---

## 5. Danh mục Kiểm tra Bảo mật (Security Checklist)

Trước khi commit mã nguồn hoặc kết thúc một task liên quan đến API:
- [x] Controller handler đã khai báo `@CurrentUser()`?
- [x] Có endpoint nào nhận `userId` từ body/query không? (Nếu có: xóa ngay).
- [x] Repository đã thêm điều kiện `where: { userId, deletedAt: null }` chưa?
- [x] Đã có unit test kiểm tra từ chối truy cập khi thiếu Bearer token ở chế độ `keycloak` chưa?
- [x] Đã kiểm tra tính tương thích ở cả 2 chế độ `AUTH_MODE=keycloak` và `AUTH_MODE=dev_bypass` chưa?
