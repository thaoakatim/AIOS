import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface KeycloakTokenPayload {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  email_verified?: boolean;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  scope?: string;
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, { roles?: string[] }>;
  [key: string]: unknown;
}

export interface JwkKey {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
  [key: string]: unknown;
}

const ALG_MAP: Record<string, string> = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512',
  ES256: 'sha256',
  ES384: 'sha384',
  ES512: 'sha512',
};

/**
 * KeycloakJwtVerifier — Xác thực Access Token phát hành từ Keycloak.
 *
 * Tiêu chí xác thực:
 * - Format JWT hợp lệ (header.payload.signature).
 * - Chữ ký mật mã qua JWKS (RS256 / ES256) sử dụng thư viện chuẩn Node.js crypto.
 * - Thời gian sống: `exp` (chưa hết hạn) và `nbf` (đã có hiệu lực).
 * - Định danh Issuer (`iss`) khớp với Keycloak Realm URL.
 * - Định danh Audience (`aud`) khớp với Client ID nếu được cấu hình.
 */
@Injectable()
export class KeycloakJwtVerifier {
  private readonly logger = new Logger(KeycloakJwtVerifier.name);
  private readonly jwksCache = new Map<string, crypto.KeyObject>();
  private lastJwksFetch = 0;
  private readonly jwksTtlMs = 60 * 60 * 1000; // 1 giờ

  constructor(private readonly configService: ConfigService) {}

  /** Cho phép nạp trực tiếp public key vào cache (tiện ích cho Unit Test) */
  setTestPublicKey(kid: string, key: crypto.KeyObject | crypto.JsonWebKey): void {
    if ('export' in key && typeof key.export === 'function') {
      this.jwksCache.set(kid, key as crypto.KeyObject);
    } else {
      const keyObj = crypto.createPublicKey({
        key: key as crypto.JsonWebKey,
        format: 'jwk',
      });
      this.jwksCache.set(kid, keyObj);
    }
  }

  /** Xóa cache JWKS (cho test hoặc khi refresh) */
  clearCache(): void {
    this.jwksCache.clear();
    this.lastJwksFetch = 0;
  }

  getExpectedIssuer(): string {
    const customIssuer = this.configService.get<string>('KEYCLOAK_ISSUER');
    if (customIssuer) return customIssuer;
    const url = this.configService.get<string>('KEYCLOAK_URL', 'http://localhost:8080');
    const realm = this.configService.get<string>('KEYCLOAK_REALM', 'aios');
    return `${url.replace(/\/+$/, '')}/realms/${realm}`;
  }

  getExpectedAudience(): string | undefined {
    return this.configService.get<string>('KEYCLOAK_CLIENT_ID');
  }

  getJwksUrl(): string {
    const customJwks = this.configService.get<string>('KEYCLOAK_JWKS_URL');
    if (customJwks) return customJwks;
    const issuer = this.getExpectedIssuer();
    return `${issuer}/protocol/openid-connect/certs`;
  }

  /**
   * Xác thực và giải mã Keycloak JWT.
   */
  async verify(token: string): Promise<KeycloakTokenPayload> {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Token không được để trống.');
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Định dạng JWT không hợp lệ (cần 3 phần).');
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // 1. Parse Header
    let header: { alg?: string; kid?: string; typ?: string };
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Header của JWT không phải JSON hợp lệ.');
    }

    if (!header.alg || !ALG_MAP[header.alg]) {
      throw new UnauthorizedException(`Thuật toán ký "${header.alg}" không được hỗ trợ.`);
    }

    if (!header.kid) {
      throw new UnauthorizedException('JWT header thiếu trường "kid".');
    }

    // 2. Parse Payload
    let payload: KeycloakTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Payload của JWT không phải JSON hợp lệ.');
    }

    // 3. Kiểm tra Claims
    const now = Math.floor(Date.now() / 1000);

    if (!payload.sub) {
      throw new UnauthorizedException('JWT payload thiếu trường "sub".');
    }

    if (payload.exp !== undefined && payload.exp <= now) {
      throw new UnauthorizedException('Token đã hết hạn.');
    }

    if (payload.nbf !== undefined && payload.nbf > now) {
      throw new UnauthorizedException('Token chưa có hiệu lực.');
    }

    const expectedIssuer = this.getExpectedIssuer();
    if (payload.iss && payload.iss !== expectedIssuer) {
      throw new UnauthorizedException(
        `Issuer "${payload.iss}" không khớp với cấu hình hệ thống "${expectedIssuer}".`,
      );
    }

    const expectedAudience = this.getExpectedAudience();
    if (expectedAudience && payload.aud) {
      const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!auds.includes(expectedAudience)) {
        throw new UnauthorizedException(
          `Audience "${auds.join(',')}" không chứa client "${expectedAudience}".`,
        );
      }
    }

    // 4. Lấy Public Key theo `kid`
    const publicKey = await this.resolvePublicKey(header.kid);

    // 5. Xác thực chữ ký
    const cryptoAlg = ALG_MAP[header.alg];
    const dataToVerify = `${headerB64}.${payloadB64}`;
    const signatureBuffer = Buffer.from(signatureB64, 'base64url');

    try {
      const verifier = crypto.createVerify(cryptoAlg);
      verifier.update(dataToVerify);
      const isSignatureValid = verifier.verify(publicKey, signatureBuffer);
      if (!isSignatureValid) {
        throw new UnauthorizedException('Chữ ký của JWT không hợp lệ.');
      }
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Lỗi khi kiểm tra chữ ký JWT: ${msg}`);
      throw new UnauthorizedException('Không thể xác thực chữ ký của token.');
    }

    return payload;
  }

  private async resolvePublicKey(kid: string): Promise<crypto.KeyObject> {
    if (this.jwksCache.has(kid)) {
      return this.jwksCache.get(kid)!;
    }

    // Nếu chưa có trong cache hoặc cache hết hạn, fetch lại từ JWKS endpoint
    await this.refreshJwks();

    if (this.jwksCache.has(kid)) {
      return this.jwksCache.get(kid)!;
    }

    throw new UnauthorizedException(`Không tìm thấy public key cho kid "${kid}" từ Keycloak JWKS.`);
  }

  private async refreshJwks(): Promise<void> {
    const now = Date.now();
    if (now - this.lastJwksFetch < this.jwksTtlMs && this.jwksCache.size > 0) {
      return;
    }

    const jwksUrl = this.getJwksUrl();
    try {
      const response = await fetch(jwksUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const body = (await response.json()) as { keys?: JwkKey[] };
      if (!body.keys || !Array.isArray(body.keys)) {
        throw new Error('JWKS payload không chứa mảng "keys".');
      }

      for (const jwk of body.keys) {
        if (jwk.kid && jwk.kty) {
          try {
            const keyObj = crypto.createPublicKey({
              key: jwk as unknown as crypto.JsonWebKey,
              format: 'jwk',
            });
            this.jwksCache.set(jwk.kid, keyObj);
          } catch (keyErr) {
            this.logger.warn(`Không thể import JWK kid=${jwk.kid}: ${keyErr}`);
          }
        }
      }

      this.lastJwksFetch = now;
      this.logger.log(`Đã nạp ${this.jwksCache.size} JWK keys từ ${jwksUrl}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Không thể nạp JWKS từ ${jwksUrl}: ${message}`);
      // Nếu có sẵn cache cũ thì dùng tạm
      if (this.jwksCache.size === 0) {
        throw new UnauthorizedException(
          `Không thể kết nối tới Keycloak JWKS endpoint: ${message}`,
        );
      }
    }
  }
}
