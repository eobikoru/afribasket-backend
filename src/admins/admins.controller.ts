import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { changeRoleSchema, createAdminSchema } from '../auth/auth.schemas';
import { CurrentUser, Roles } from '../auth/decorators';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import type { AuthUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { paginationSchema } from '../common/pagination';
import { ApiFilterQuery, ApiZodBody, PAGE_QUERIES } from '../common/swagger';
import { AdminsService } from './admins.service';

@ApiTags('admins')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/admins')
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an admin' })
  @ApiZodBody(createAdminSchema)
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createAdminSchema)) body: z.infer<typeof createAdminSchema>) {
    return this.admins.create(user.id, body);
  }

  @Get()
  @ApiOperation({ summary: 'List admins' })
  @ApiFilterQuery(PAGE_QUERIES)
  list(@Query(new ZodValidationPipe(paginationSchema)) query: z.infer<typeof paginationSchema>) {
    return this.admins.list(query);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Admin action audit log' })
  @ApiFilterQuery(PAGE_QUERIES)
  audit(@Query(new ZodValidationPipe(paginationSchema)) query: z.infer<typeof paginationSchema>) {
    return this.admins.listAudit(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an admin' })
  get(@Param('id') id: string) {
    return this.admins.get(id);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Change an admin role' })
  @ApiZodBody(changeRoleSchema)
  role(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: z.infer<typeof changeRoleSchema>,
  ) {
    return this.admins.changeRole(user.id, id, body.role);
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate an admin' })
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admins.setActive(user.id, id, false);
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate an admin' })
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admins.setActive(user.id, id, true);
  }
}
