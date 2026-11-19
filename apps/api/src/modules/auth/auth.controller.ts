import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './entities/authenticated-user.interface';
import { AuthMeResponseDto, LogoutResponseDto } from './dto/auth-response.dto';

/**
 * AuthController — Cung cấp các endpoint quản trị phiên làm việc và danh tính người dùng.
 *
 * Mọi request đều được bảo vệ bởi `AIOSAuthGuard` toàn cục (trừ các route có `@Public()`).
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * `GET /auth/me` — Trả về thông tin profile người dùng hiện tại và trạng thái authMode.
   */
  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<AuthMeResponseDto> {
    return this.authService.getMe(user);
  }

  /**
   * `POST /auth/logout` — Xóa session local của người dùng.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user?: AuthenticatedUser): Promise<LogoutResponseDto> {
    return this.authService.logout(user);
  }
}
