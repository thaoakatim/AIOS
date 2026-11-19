import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UserRepository } from './user.repository';
import { KeycloakJwtVerifier } from './keycloak-jwt-verifier.service';
import { DEFAULT_LOCAL_USER_ID } from '../../core/auth/default-user';

describe('AuthService', () => {
  let service: AuthService;

  const userRepositoryMock = {
    findById: jest.fn(),
    findByKeycloakSubject: jest.fn(),
    findByEmail: jest.fn(),
    upsertFromKeycloak: jest.fn(),
    ensureDefaultLocalUser: jest.fn(),
  };

  const jwtVerifierMock = {
    verify: jest.fn(),
  };

  const configServiceMock = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserRepository, useValue: userRepositoryMock },
        { provide: KeycloakJwtVerifier, useValue: jwtVerifierMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAuthMode', () => {
    it('returns dev_bypass when AUTH_MODE=dev_bypass', () => {
      configServiceMock.get.mockReturnValue('dev_bypass');
      expect(service.getAuthMode()).toBe('dev_bypass');
    });

    it('defaults to keycloak when AUTH_MODE is not dev_bypass', () => {
      configServiceMock.get.mockReturnValue('keycloak');
      expect(service.getAuthMode()).toBe('keycloak');

      configServiceMock.get.mockReturnValue(undefined);
      expect(service.getAuthMode()).toBe('keycloak');
    });
  });

  describe('resolveDevUser', () => {
    it('returns default local user projection', async () => {
      userRepositoryMock.ensureDefaultLocalUser.mockResolvedValue({
        id: DEFAULT_LOCAL_USER_ID,
        email: 'local-dev@aios.local',
        displayName: 'Default Local User',
        emailVerified: true,
        keycloakSubject: null,
      });

      const user = await service.resolveDevUser();
      expect(user.id).toBe(DEFAULT_LOCAL_USER_ID);
      expect(user.authMode).toBe('dev_bypass');
      expect(user.roles).toContain('developer');
      expect(userRepositoryMock.ensureDefaultLocalUser).toHaveBeenCalled();
    });
  });

  describe('validateKeycloakToken', () => {
    it('verifies token and upserts user', async () => {
      jwtVerifierMock.verify.mockResolvedValue({
        sub: 'sub-xyz',
        email: 'person@aios.local',
        name: 'Person Name',
        email_verified: true,
        realm_access: { roles: ['user', 'admin'] },
      });

      userRepositoryMock.upsertFromKeycloak.mockResolvedValue({
        id: 'u-xyz',
        keycloakSubject: 'sub-xyz',
        email: 'person@aios.local',
        displayName: 'Person Name',
        emailVerified: true,
      });

      const result = await service.validateKeycloakToken('valid-jwt-token');

      expect(jwtVerifierMock.verify).toHaveBeenCalledWith('valid-jwt-token');
      expect(userRepositoryMock.upsertFromKeycloak).toHaveBeenCalledWith({
        keycloakSubject: 'sub-xyz',
        email: 'person@aios.local',
        displayName: 'Person Name',
        emailVerified: true,
      });
      expect(result.id).toBe('u-xyz');
      expect(result.authMode).toBe('keycloak');
      expect(result.roles).toEqual(['user', 'admin']);
    });
  });

  describe('getMe', () => {
    it('returns profile of authenticated user', async () => {
      userRepositoryMock.findById.mockResolvedValue({
        id: 'u-1',
        email: 'user@aios.local',
        displayName: 'User One',
        keycloakSubject: 'sub-1',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getMe({
        id: 'u-1',
        email: 'user@aios.local',
        displayName: 'User One',
        keycloakSubject: 'sub-1',
        emailVerified: true,
        authMode: 'keycloak',
      });

      expect(result.user.id).toBe('u-1');
      expect(result.authMode).toBe('keycloak');
    });

    it('throws UnauthorizedException if user context is missing', async () => {
      await expect(service.getMe(null as any)).rejects.toThrow(UnauthorizedException);
    });

    it('throws NotFoundException if user not found in database', async () => {
      userRepositoryMock.findById.mockResolvedValue(null);
      await expect(
        service.getMe({
          id: 'non-existent',
          email: 'none@aios.local',
          displayName: null,
          keycloakSubject: null,
          emailVerified: false,
          authMode: 'dev_bypass',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('logout', () => {
    it('returns success response', async () => {
      const result = await service.logout();
      expect(result.success).toBe(true);
    });
  });
});
