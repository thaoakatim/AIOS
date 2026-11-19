import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { KeycloakJwtVerifier } from './keycloak-jwt-verifier.service';

describe('KeycloakJwtVerifier', () => {
  let verifier: KeycloakJwtVerifier;
  let keyPair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
  const testKid = 'test-key-id-1';

  beforeAll(() => {
    keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  });

  const createTestJwt = (
    payloadOverrides: Record<string, unknown> = {},
    headerOverrides: Record<string, unknown> = {},
    signWithKey = keyPair.privateKey,
  ): string => {
    const header = {
      alg: 'RS256',
      typ: 'JWT',
      kid: testKid,
      ...headerOverrides,
    };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'keycloak-sub-123',
      email: 'user@aios.local',
      iss: 'http://localhost:8080/realms/aios',
      aud: 'aios-api',
      exp: now + 3600,
      nbf: now - 10,
      ...payloadOverrides,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const data = `${headerB64}.${payloadB64}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(data);
    const sigB64 = signer.sign(signWithKey).toString('base64url');

    return `${data}.${sigB64}`;
  };

  beforeEach(async () => {
    const configMock = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'KEYCLOAK_URL') return 'http://localhost:8080';
        if (key === 'KEYCLOAK_REALM') return 'aios';
        if (key === 'KEYCLOAK_CLIENT_ID') return 'aios-api';
        return def;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakJwtVerifier,
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    verifier = module.get<KeycloakJwtVerifier>(KeycloakJwtVerifier);
    verifier.setTestPublicKey(testKid, keyPair.publicKey);
  });

  it('should be defined', () => {
    expect(verifier).toBeDefined();
  });

  it('verifies a valid RS256 token and returns the payload', async () => {
    const token = createTestJwt({
      name: 'Nguyen Van A',
      preferred_username: 'anv',
    });

    const payload = await verifier.verify(token);
    expect(payload.sub).toBe('keycloak-sub-123');
    expect(payload.email).toBe('user@aios.local');
    expect(payload.name).toBe('Nguyen Van A');
  });

  it('throws UnauthorizedException on empty or non-string token', async () => {
    await expect(verifier.verify('')).rejects.toThrow(UnauthorizedException);
    await expect(verifier.verify(null as unknown as string)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException on malformed token format', async () => {
    await expect(verifier.verify('only.two.parts.excess')).rejects.toThrow(
      'Định dạng JWT không hợp lệ',
    );
  });

  it('throws UnauthorizedException when expired', async () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    const token = createTestJwt({ exp: past });
    await expect(verifier.verify(token)).rejects.toThrow('Token đã hết hạn.');
  });

  it('throws UnauthorizedException when nbf is in the future', async () => {
    const future = Math.floor(Date.now() / 1000) + 1000;
    const token = createTestJwt({ nbf: future });
    await expect(verifier.verify(token)).rejects.toThrow('Token chưa có hiệu lực.');
  });

  it('throws UnauthorizedException when sub claim is missing', async () => {
    const token = createTestJwt({ sub: undefined });
    await expect(verifier.verify(token)).rejects.toThrow('thiếu trường "sub"');
  });

  it('throws UnauthorizedException when issuer does not match', async () => {
    const token = createTestJwt({ iss: 'http://malicious-issuer.com' });
    await expect(verifier.verify(token)).rejects.toThrow('không khớp với cấu hình');
  });

  it('throws UnauthorizedException when audience does not match', async () => {
    const token = createTestJwt({ aud: 'wrong-audience' });
    await expect(verifier.verify(token)).rejects.toThrow('không chứa client');
  });

  it('throws UnauthorizedException when signature is invalid', async () => {
    const otherKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = createTestJwt({}, {}, otherKeyPair.privateKey);
    await expect(verifier.verify(token)).rejects.toThrow('Chữ ký của JWT không hợp lệ.');
  });

  it('throws UnauthorizedException when kid is not found in JWKS', async () => {
    const token = createTestJwt({}, { kid: 'non-existent-kid' });
    await expect(verifier.verify(token)).rejects.toThrow('Không tìm thấy public key cho kid');
  });

  it('throws UnauthorizedException on unsupported algorithm', async () => {
    const token = createTestJwt({}, { alg: 'HS256' });
    await expect(verifier.verify(token)).rejects.toThrow('không được hỗ trợ');
  });
});
