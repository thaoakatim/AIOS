import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeycloakJwtVerifier } from './keycloak-jwt-verifier.service';
import { UserRepository } from './user.repository';
import { AuthenticatedUser } from './entities/authenticated-user.interface';
import { UserEntity } from './entities/user.entity';
import { AuthMeResponseDto, LogoutResponseDto } from './dto/auth-response.dto';

/**
 * AuthService — Điều phối nghiệp vụ xác thực và quản lý session của AIOS.
 *
 * Hỗ trợ Dual-Mode:
 * - `keycloak`: Môi trường Prod/Staging/Dev có Keycloak OIDC. Bắt buộc Bearer JWT hợp lệ.
 * - `dev_bypass`: Môi trường Local Dev / Zero-daemon. Tự động resolve Default Local User.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtVerifier: KeycloakJwtVerifier,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Lấy chế độ xác thực hiện tại từ biến môi trường `AUTH_MODE`.
   * Mặc định là 'keycloak'.
   */
  getAuthMode(): 'keycloak' | 'dev_bypass' {
    const mode = this.configService.get<string>('AUTH_MODE', 'keycloak');
    return mode === 'dev_bypass' ? 'dev_bypass' : 'keycloak';
  }

  /**
   * Resolve thông tin Default Local User cho chế độ dev_bypass.
   * Cấm tuyệt đối tin tưởng userId gửi từ client!
   */
  async resolveDevUser(): Promise<AuthenticatedUser> {
    const user = await this.userRepository.ensureDefaultLocalUser();
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      keycloakSubject: null,
      emailVerified: user.emailVerified,
      authMode: 'dev_bypass',
      roles: ['user', 'developer'],
    };
  }

  /**
   * Xác thực Keycloak Bearer JWT Token và đồng bộ profile người dùng vào database.
   */
  async validateKeycloakToken(token: string): Promise<AuthenticatedUser> {
    const payload = await this.jwtVerifier.verify(token);

    const email =
      payload.email ||
      (typeof payload.preferred_username === 'string' &&
      payload.preferred_username.includes('@')
        ? payload.preferred_username
        : `${payload.sub}@aios.local`);

    const displayName =
      payload.name ||
      (typeof payload.preferred_username === 'string'
        ? payload.preferred_username
        : null);

    const emailVerified = Boolean(payload.email_verified);

    const user = await this.userRepository.upsertFromKeycloak({
      keycloakSubject: payload.sub,
      email,
      displayName,
      emailVerified,
    });

    const roles = payload.realm_access?.roles ?? [];

    this.logger.debug(
      `Xác thực thành công user=${user.id} sub=${payload.sub} email=${email}`,
    );

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      keycloakSubject: user.keycloakSubject,
      emailVerified: user.emailVerified,
      authMode: 'keycloak',
      roles,
    };
  }

  /**
   * Lấy thông tin profile người dùng hiện tại kèm theo trạng thái authMode.
   */
  async getMe(user: AuthenticatedUser): Promise<AuthMeResponseDto> {
    if (!user || !user.id) {
      throw new UnauthorizedException('Yêu cầu chưa được xác thực.');
    }

    const found = await this.userRepository.findById(user.id);
    if (!found) {
      throw new NotFoundException(`Không tìm thấy người dùng với ID "${user.id}".`);
    }

    return {
      user: UserEntity.fromPrisma(found),
      authMode: user.authMode,
    };
  }

  /**
   * Đăng xuất phiên làm việc (phục vụ client local cleanup).
   */
  async logout(user?: AuthenticatedUser): Promise<LogoutResponseDto> {
    if (user) {
      this.logger.log(`User ${user.id} (${user.email}) đã đăng xuất.`);
    }
    return {
      success: true,
      message: 'Đăng xuất thành công.',
    };
  }
}
