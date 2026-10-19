import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admins/admins.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { paginationSchema } from '../common/pagination';
import { couponSchema, couponUpdateSchema, CouponsService } from './coupons.service';

@ApiTags('admin-coupons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/coupons')
export class CouponsController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(paginationSchema)) query: z.infer<typeof paginationSchema>) {
    return this.coupons.list(query);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(couponSchema)) body: z.infer<typeof couponSchema>) {
    const coupon = await this.coupons.create(body);
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'coupon', entityId: coupon.id });
    return coupon;
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(couponUpdateSchema)) body: z.infer<typeof couponUpdateSchema>,
  ) {
    const coupon = await this.coupons.update(id, body);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'coupon', entityId: id });
    return coupon;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.coupons.remove(id);
    await this.audit.record({ adminId: user.id, action: 'delete', entityType: 'coupon', entityId: id });
    return result;
  }
}
