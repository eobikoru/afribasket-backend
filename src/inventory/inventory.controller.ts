import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdjustmentReason } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../admins/admins.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { paginationSchema } from '../common/pagination';
import { ApiFilterQuery, PAGE_QUERIES } from '../common/swagger';
import { InventoryService } from './inventory.service';

const adjustSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(),
  delta: z.number().int().refine((value) => value !== 0, 'Delta cannot be zero'),
  reason: z.nativeEnum(AdjustmentReason),
  note: z.string().max(500).optional(),
  lotId: z.string().optional(),
});

const recordSchema = z.object({
  variantId: z.string().optional(),
  quantityIncoming: z.number().int().nonnegative().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  reorderPoint: z.number().int().nonnegative().optional(),
  reorderQuantity: z.number().int().nonnegative().optional(),
  warehouseLocation: z.string().max(80).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const lotSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  lotCode: z.string().trim().min(1).max(64),
  quantity: z.number().int().positive(),
  bestByDate: z.coerce.date(),
  receivedAt: z.coerce.date().optional(),
});

const movementQuery = paginationSchema.extend({ productId: z.string().optional() });

@ApiTags('admin-inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  @Get('low-stock')
  @ApiOperation({ summary: 'Products and packs at or below their low-stock threshold' })
  low() {
    return this.inventory.lowStock();
  }

  @Get('counts')
  counts() {
    return this.inventory.counts();
  }

  @Get('movements')
  @ApiFilterQuery([...PAGE_QUERIES, { name: 'productId', description: 'Filter by product' }])
  movements(@Query(new ZodValidationPipe(movementQuery)) query: z.infer<typeof movementQuery>) {
    return this.inventory.listMovements(query);
  }

  @Get('lots')
  @ApiOperation({ summary: 'Food lots. Pass expiringWithinDays=14 for the near-expiry list.' })
  lots(@Query('productId') productId?: string, @Query('expiringWithinDays') expiringWithinDays?: string) {
    return this.inventory.listLots({
      productId,
      expiringWithinDays: expiringWithinDays ? Number(expiringWithinDays) : undefined,
    });
  }

  @Post('lots')
  async receive(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(lotSchema)) body: z.infer<typeof lotSchema>) {
    const lot = await this.inventory.receiveLot({ ...body, adminId: user.id });
    await this.audit.record({
      adminId: user.id,
      action: 'stock_adjustment',
      entityType: 'lot',
      entityId: lot.id,
      metadata: { quantity: body.quantity, lotCode: body.lotCode },
    });
    return lot;
  }

  @Get(':productId')
  get(@Param('productId') productId: string) {
    return this.inventory.get(productId);
  }

  @Patch(':productId')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(recordSchema)) body: z.infer<typeof recordSchema>,
  ) {
    const record = await this.inventory.updateRecord(productId, body);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'inventory', entityId: productId });
    return record;
  }

  @Post('adjustments')
  async adjust(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(adjustSchema)) body: z.infer<typeof adjustSchema>) {
    const movement = await this.inventory.adjust(user.id, body);
    await this.audit.record({
      adminId: user.id,
      action: 'stock_adjustment',
      entityType: 'inventory',
      entityId: body.productId,
      metadata: { delta: body.delta, reason: body.reason, movementId: movement.id },
    });
    return movement;
  }
}
