import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator `@Public()` — Đánh dấu endpoint không yêu cầu xác thực JWT / Bearer Token.
 * Sử dụng cho các route health-check, companion pairing handshake.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
