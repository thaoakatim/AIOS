/**
 * AuthenticatedUser — Đối tượng người dùng đã được xác thực thành công qua AIOSAuthGuard.
 * Được gắn vào `request.user` và truy xuất qua `@CurrentUser()`.
 */
export interface AuthenticatedUser {
  /** Database User ID (UUID) */
  readonly id: string;
  /** Email của người dùng */
  readonly email: string;
  /** Tên hiển thị */
  readonly displayName: string | null;
  /** Subject ID từ Keycloak (null nếu ở chế độ dev_bypass / local) */
  readonly keycloakSubject: string | null;
  /** Trạng thái xác thực email */
  readonly emailVerified: boolean;
  /** Chế độ xác thực đã cấp phiên */
  readonly authMode: 'keycloak' | 'dev_bypass';
  /** Danh sách vai trò / realm roles (nếu có từ token) */
  readonly roles?: string[];
}
