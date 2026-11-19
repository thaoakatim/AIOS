import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserRepository } from './user.repository';
import { KeycloakJwtVerifier } from './keycloak-jwt-verifier.service';
import { AIOSAuthGuard } from './guards/aios-auth.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    UserRepository,
    KeycloakJwtVerifier,
    AuthService,
    AIOSAuthGuard,
    {
      provide: APP_GUARD,
      useClass: AIOSAuthGuard,
    },
  ],
  exports: [AuthService, UserRepository, KeycloakJwtVerifier, AIOSAuthGuard],
})
export class AuthModule {}
