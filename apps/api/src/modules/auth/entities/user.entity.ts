import { IUser } from '@aios/shared-types';
import { User as PrismaUser } from '@prisma/client';

export class UserEntity implements IUser {
  id: string;
  keycloakSubject: string | null;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }

  static fromPrisma(user: PrismaUser): UserEntity {
    return new UserEntity({
      id: user.id,
      keycloakSubject: user.keycloakSubject,
      email: user.email,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }
}
