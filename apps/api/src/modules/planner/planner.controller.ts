import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/entities/authenticated-user.interface';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { DecomposeGoalDto } from './dto/decompose-goal.dto';
import { QueryPlanDto } from './dto/query-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { PlannerService } from './planner.service';

@Controller('planner')
export class PlannerController {
  constructor(private readonly plannerService: PlannerService) {}

  // --------------------------------------------------- AI Decomposition --

  @Post('decompose')
  @HttpCode(HttpStatus.OK)
  decomposeGoal(
    @Body() dto: DecomposeGoalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plannerService.decomposeGoal(dto, user);
  }

  // ----------------------------------------------------------- Plan CRUD --

  @Post('plans')
  createPlan(
    @Body() dto: CreatePlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plannerService.createPlan(dto, user);
  }

  @Get('plans')
  listPlans(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const query: QueryPlanDto = {
      status: status || undefined,
      search,
      limit: limit !== undefined && limit !== '' ? Number(limit) : undefined,
      offset:
        offset !== undefined && offset !== '' ? Number(offset) : undefined,
    };
    return this.plannerService.listPlans(query, user);
  }

  @Get('plans/:id/roadmap')
  getRoadmap(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plannerService.getRoadmap(id, user);
  }

  @Get('plans/:id')
  getPlan(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plannerService.getPlan(id, user);
  }

  @Patch('plans/:id')
  updatePlan(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plannerService.updatePlan(id, dto, user);
  }

  @Delete('plans/:id')
  deletePlan(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plannerService.deletePlan(id, user);
  }

  // ----------------------------------------------------------- Task CRUD --

  @Post('plans/:planId/tasks')
  createTask(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plannerService.createTask(planId, dto, user);
  }

  @Get('plans/:planId/tasks')
  listTasksByPlan(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plannerService.listTasksByPlan(planId, user);
  }

  @Patch('tasks/:taskId')
  updateTask(
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plannerService.updateTask(taskId, dto, user);
  }

  @Delete('tasks/:taskId')
  deleteTask(
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plannerService.deleteTask(taskId, user);
  }
}
