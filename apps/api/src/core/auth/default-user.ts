/**
 * Default Local User dùng cho chế độ dev_bypass và local zero-daemon.
 * Định danh người dùng mặc định khi chưa kích hoạt Keycloak Server.
 */
export const DEFAULT_LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001';

export const DEFAULT_LOCAL_USER = {
  id: DEFAULT_LOCAL_USER_ID,
  keycloakSubject: null,
  email: 'local-dev@aios.local',
  displayName: 'Default Local User',
  emailVerified: true,
} as const;
