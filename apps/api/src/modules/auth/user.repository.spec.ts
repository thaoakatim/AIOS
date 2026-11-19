import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { UserRepository } from './user.repository';
import {
  DEFAULT_LOCAL_USER,
  DEFAULT_LOCAL_USER_ID,
} from '../../core/auth/default-user';

describe('UserRepository', () => {
  let repository: UserRepository;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    repository = module.get<UserRepository>(UserRepository);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  it('findById calls prisma.user.findUnique', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u-1' });
    await expect(repository.findById('u-1')).resolves.toEqual({ id: 'u-1' });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u-1' },
    });
  });

  it('findByKeycloakSubject calls prisma.user.findUnique', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u-1', keycloakSubject: 'sub-1' });
    await expect(repository.findByKeycloakSubject('sub-1')).resolves.toEqual({
      id: 'u-1',
      keycloakSubject: 'sub-1',
    });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { keycloakSubject: 'sub-1' },
    });
  });

  it('findByEmail calls prisma.user.findFirst', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 'u-1', email: 'test@aios.local' });
    await expect(repository.findByEmail('test@aios.local')).resolves.toEqual({
      id: 'u-1',
      email: 'test@aios.local',
    });
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { email: 'test@aios.local' },
    });
  });

  describe('upsertFromKeycloak', () => {
    it('updates user if keycloakSubject already exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u-1',
        keycloakSubject: 'sub-1',
        email: 'old@aios.local',
        displayName: 'Old Name',
        emailVerified: false,
      });
      prismaMock.user.update.mockResolvedValue({
        id: 'u-1',
        keycloakSubject: 'sub-1',
        email: 'new@aios.local',
        displayName: 'New Name',
        emailVerified: true,
      });

      const result = await repository.upsertFromKeycloak({
        keycloakSubject: 'sub-1',
        email: 'new@aios.local',
        displayName: 'New Name',
        emailVerified: true,
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: {
          email: 'new@aios.local',
          displayName: 'New Name',
          emailVerified: true,
        },
      });
      expect(result.email).toBe('new@aios.local');
    });

    it('links keycloakSubject if user exists with matching email without subject', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'u-2',
        keycloakSubject: null,
        email: 'link@aios.local',
        displayName: 'Existing User',
        emailVerified: false,
      });
      prismaMock.user.update.mockResolvedValue({
        id: 'u-2',
        keycloakSubject: 'sub-2',
        email: 'link@aios.local',
        displayName: 'Existing User',
        emailVerified: true,
      });

      const result = await repository.upsertFromKeycloak({
        keycloakSubject: 'sub-2',
        email: 'link@aios.local',
        emailVerified: true,
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u-2' },
        data: {
          keycloakSubject: 'sub-2',
          displayName: 'Existing User',
          emailVerified: true,
        },
      });
      expect(result.id).toBe('u-2');
    });

    it('creates new user if no match found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.findFirst.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'u-3',
        keycloakSubject: 'sub-3',
        email: 'fresh@aios.local',
        displayName: 'Fresh User',
        emailVerified: true,
      });

      const result = await repository.upsertFromKeycloak({
        keycloakSubject: 'sub-3',
        email: 'fresh@aios.local',
        displayName: 'Fresh User',
        emailVerified: true,
      });

      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: {
          keycloakSubject: 'sub-3',
          email: 'fresh@aios.local',
          displayName: 'Fresh User',
          emailVerified: true,
        },
      });
      expect(result.id).toBe('u-3');
    });
  });

  describe('ensureDefaultLocalUser', () => {
    it('upserts DEFAULT_LOCAL_USER into prisma', async () => {
      prismaMock.user.upsert.mockResolvedValue({
        id: DEFAULT_LOCAL_USER_ID,
        email: DEFAULT_LOCAL_USER.email,
        displayName: DEFAULT_LOCAL_USER.displayName,
      });

      const result = await repository.ensureDefaultLocalUser();
      expect(prismaMock.user.upsert).toHaveBeenCalledWith({
        where: { id: DEFAULT_LOCAL_USER_ID },
        update: {},
        create: {
          id: DEFAULT_LOCAL_USER_ID,
          keycloakSubject: null,
          email: DEFAULT_LOCAL_USER.email,
          displayName: DEFAULT_LOCAL_USER.displayName,
          emailVerified: true,
        },
      });
      expect(result.id).toBe(DEFAULT_LOCAL_USER_ID);
    });
  });
});
