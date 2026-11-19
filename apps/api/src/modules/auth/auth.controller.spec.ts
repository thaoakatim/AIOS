import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './entities/authenticated-user.interface';

describe('AuthController', () => {
  let controller: AuthController;

  const authServiceMock = {
    getMe: jest.fn(),
    logout: jest.fn(),
  };

  const sampleUser: AuthenticatedUser = {
    id: 'u-1',
    email: 'user@aios.local',
    displayName: 'User One',
    keycloakSubject: 'sub-1',
    emailVerified: true,
    authMode: 'keycloak',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getMe delegates to AuthService.getMe', async () => {
    authServiceMock.getMe.mockResolvedValue({
      user: sampleUser,
      authMode: 'keycloak',
    });

    const result = await controller.getMe(sampleUser);
    expect(authServiceMock.getMe).toHaveBeenCalledWith(sampleUser);
    expect(result.authMode).toBe('keycloak');
  });

  it('logout delegates to AuthService.logout', async () => {
    authServiceMock.logout.mockResolvedValue({
      success: true,
      message: 'Đăng xuất thành công.',
    });

    const result = await controller.logout(sampleUser);
    expect(authServiceMock.logout).toHaveBeenCalledWith(sampleUser);
    expect(result.success).toBe(true);
  });
});
