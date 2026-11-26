import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module';
import { AuthModule } from '../auth/auth.module';
import { PlannerController } from './planner.controller';
import { PlannerRepository } from './planner.repository';
import { PlannerService } from './planner.service';

@Module({
  imports: [PrismaModule, InfrastructureModule, AuthModule],
  controllers: [PlannerController],
  providers: [PlannerRepository, PlannerService],
  exports: [PlannerService, PlannerRepository],
})
export class PlannerModule {}
