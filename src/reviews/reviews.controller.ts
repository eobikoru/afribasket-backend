import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admins/admins.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Errors } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { paginationSchema } from '../common/pagination';
import { reviewSchema, ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller('products/:productId/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(
    @Param('productId') productId: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: z.infer<typeof paginationSchema>,
  ) {
    return this.reviews.list(productId, query.page, query.perPage);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(reviewSchema)) body: z.infer<typeof reviewSchema>,
  ) {
    if (user.type !== 'customer') throw Errors.forbidden('Customer login required');
    return this.reviews.create(user.id, productId, body);
  }
}

@ApiTags('admin-reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly audit: AuditService,
  ) {}

  @Post(':id/hide')
  async hide(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const review = await this.reviews.setHidden(id, true);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'review', entityId: id, metadata: { hidden: true } });
    return review;
  }

  @Post(':id/unhide')
  async unhide(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const review = await this.reviews.setHidden(id, false);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'review', entityId: id, metadata: { hidden: false } });
    return review;
  }
}
