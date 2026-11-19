import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  DEFAULT_LOCAL_USER,
  DEFAULT_LOCAL_USER_ID,
} from '../../core/auth/default-user';

export interface KeycloakUserUpsertData {
  keycloakSubject: string;
  email: string;
  displayName?: string | null;
  emailVerified?: boolean;
}

/**
 * UserRepository — Quản lý projection người dùng trong database của AIOS.
 *
 * Nhiệm vụ:
 * - Lưu trữ và truy vấn profile `User` được map từ Keycloak Subject.
 * - Khởi tạo và bảo đảm sự tồn tại của `Default Local User` cho chế độ dev_bypass.
 * - Không lưu mật khẩu, không chứa role admin (Identity do Keycloak quản lý).
 */
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByKeycloakSubject(keycloakSubject: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { keycloakSubject } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email } });
  }

  /**
   * Tự động provision hoặc cập nhật thông tin User dựa trên JWT claims của Keycloak.
   * Nếu user đã tồn tại theo keycloakSubject: cập nhật profile mới nhất.
   * Nếu user đã tồn tại theo email (chưa liên kết subject): liên kết keycloakSubject.
   * Nếu chưa tồn tại: tạo mới user.
   */
  async upsertFromKeycloak(data: KeycloakUserUpsertData): Promise<User> {
    const existingBySubject = await this.findByKeycloakSubject(
      data.keycloakSubject,
    );
    if (existingBySubject) {
      return this.prisma.user.update({
        where: { id: existingBySubject.id },
        data: {
          email: data.email,
          displayName: data.displayName ?? existingBySubject.displayName,
          emailVerified: data.emailVerified ?? existingBySubject.emailVerified,
        },
      });
    }

    const existingByEmail = await this.findByEmail(data.email);
    if (existingByEmail && existingByEmail.keycloakSubject === null) {
      return this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          keycloakSubject: data.keycloakSubject,
          displayName: data.displayName ?? existingByEmail.displayName,
          emailVerified: data.emailVerified ?? existingByEmail.emailVerified,
        },
      });
    }

    return this.prisma.user.create({
      data: {
        keycloakSubject: data.keycloakSubject,
        email: data.email,
        displayName: data.displayName ?? null,
        emailVerified: data.emailVerified ?? false,
      },
    });
  }

  /**
   * Khởi tạo hoặc lấy Default Local User cho môi trường dev_bypass / zero-daemon.
   */
  ensureDefaultLocalUser(): Promise<User> {
    return this.prisma.user.upsert({
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
  }
}
