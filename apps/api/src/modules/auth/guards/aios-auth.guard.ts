import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * AIOSAuthGuard — Cổng kiểm soát truy cập tập trung của hệ điều hành AIOS.
 *
 * Hoạt động theo 2 chế độ (`AUTH_MODE`):
 * 1. `dev_bypass` (Local Development / Zero-daemon):
 *    - Tự động gán `Default Local User` vào `request.user`.
 *    - Cấm client gửi giả mạo userId trong body/query.
 *
 * 2. `keycloak` (Production / Staging / Dev OIDC):
 *    - Bắt buộc header `Authorization: Bearer <token>`.
 *    - Xác thực JWT bằng JWKS Keycloak, upsert User và gắn vào `request.user`.
 *
 * Các endpoint có decorator `@Public()` sẽ được bỏ qua xác thực.
 */
@Injectable()
export class AIOSAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Kiểm tra decorator @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authMode = this.authService.getAuthMode();

    // 2. Chế độ dev_bypass
    if (authMode === 'dev_bypass') {
      const devUser = await this.authService.resolveDevUser();
      request.user = devUser;
      return true;
    }

    // 3. Chế độ keycloak
    const authHeader = request.headers['authorization'] || request.headers['Authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException(
        'Yêu cầu bắt buộc phải có Authorization Bearer header.',
      );
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Header Authorization phải theo định dạng "Bearer <token>".',
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Bearer token không được để trống.');
    }

    const user = await this.authService.validateKeycloakToken(token);
    request.user = user;

    return true;
  }
}
