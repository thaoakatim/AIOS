import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AIOSAuthGuard } from './aios-auth.guard';
import { AuthService } from '../auth.service';
import { DEFAULT_LOCAL_USER_ID } from '../../../core/auth/default-user';

describe('AIOSAuthGuard', () => {
  let guard: AIOSAuthGuard;

  const reflectorMock = {
    getAllAndOverride: jest.fn(),
  };

  const authServiceMock = {
    getAuthMode: jest.fn(),
    resolveDevUser: jest.fn(),
    validateKeycloakToken: jest.fn(),
  };

  const createMockContext = (headers: Record<string, string> = {}): ExecutionContext => {
    const request = { headers, user: undefined };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIOSAuthGuard,
        { provide: Reflector, useValue: reflectorMock },
        { provide: AuthService, useValue: authServiceMock },
      ],
    }).compile();

    guard = module.get<AIOSAuthGuard>(AIOSAuthGuard);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('allows access when route has @Public decorator', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue(true);
    const context = createMockContext();

    const canActivate = await guard.canActivate(context);
    expect(canActivate).toBe(true);
    expect(authServiceMock.resolveDevUser).not.toHaveBeenCalled();
    expect(authServiceMock.validateKeycloakToken).not.toHaveBeenCalled();
  });

  describe('dev_bypass mode', () => {
    beforeEach(() => {
      reflectorMock.getAllAndOverride.mockReturnValue(false);
      authServiceMock.getAuthMode.mockReturnValue('dev_bypass');
    });

    it('resolves dev user and attaches to request without requiring headers', async () => {
      authServiceMock.resolveDevUser.mockResolvedValue({
        id: DEFAULT_LOCAL_USER_ID,
        email: 'local-dev@aios.local',
        displayName: 'Default Local User',
        keycloakSubject: null,
        emailVerified: true,
        authMode: 'dev_bypass',
      });

      const context = createMockContext();
      const canActivate = await guard.canActivate(context);

      expect(canActivate).toBe(true);
      const req = context.switchToHttp().getRequest();
      expect(req.user.id).toBe(DEFAULT_LOCAL_USER_ID);
      expect(req.user.authMode).toBe('dev_bypass');
    });
  });

  describe('keycloak mode', () => {
    beforeEach(() => {
      reflectorMock.getAllAndOverride.mockReturnValue(false);
      authServiceMock.getAuthMode.mockReturnValue('keycloak');
    });

    it('throws UnauthorizedException when Authorization header is missing', async () => {
      const context = createMockContext({});
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Yêu cầu bắt buộc phải có Authorization Bearer header.',
      );
    });

    it('throws UnauthorizedException when format is not Bearer', async () => {
      const context = createMockContext({ authorization: 'Basic 123456' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Header Authorization phải theo định dạng "Bearer <token>".',
      );
    });

    it('throws UnauthorizedException when token is empty string', async () => {
      const context = createMockContext({ authorization: 'Bearer   ' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Bearer token không được để trống.',
      );
    });

    it('validates Bearer token and attaches authenticated user to request', async () => {
      authServiceMock.validateKeycloakToken.mockResolvedValue({
        id: 'u-100',
        email: 'user@aios.local',
        displayName: 'Keycloak User',
        keycloakSubject: 'sub-100',
        emailVerified: true,
        authMode: 'keycloak',
      });

      const context = createMockContext({ authorization: 'Bearer sample-valid-token' });
      const canActivate = await guard.canActivate(context);

      expect(canActivate).toBe(true);
      expect(authServiceMock.validateKeycloakToken).toHaveBeenCalledWith(
        'sample-valid-token',
      );
      const req = context.switchToHttp().getRequest();
      expect(req.user.id).toBe('u-100');
      expect(req.user.authMode).toBe('keycloak');
    });
  });
});
