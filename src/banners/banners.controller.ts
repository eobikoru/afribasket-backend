import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admins/admins.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Errors } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ImageStorage } from '../catalog/image-storage';
import { bannerFormSchema, bannerUpdateFormSchema, BannersService } from './banners.service';

@ApiTags('banners')
@Controller('banners')
export class BannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  active() {
    return this.banners.active();
  }
}

@ApiTags('admin-banners')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/banners')
export class AdminBannersController {
  constructor(
    private readonly banners: BannersService,
    private readonly images: ImageStorage,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.banners.list();
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async create(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(bannerFormSchema)) body: z.infer<typeof bannerFormSchema>,
  ) {
    if (!file) throw Errors.badRequest('Image file is required');
    const stored = await this.images.upload(file.buffer, 'banners', file.mimetype);
    const banner = await this.banners.create({ ...body, imageUrl: stored.url, imagePublicId: stored.publicId });
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'banner', entityId: banner.id });
    return banner;
  }

  @Patch(':id')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(bannerUpdateFormSchema)) body: z.infer<typeof bannerUpdateFormSchema>,
  ) {
    const current = file ? await this.banners.get(id) : null;
    const stored = file ? await this.images.upload(file.buffer, 'banners', file.mimetype) : undefined;
    const banner = await this.banners.update(id, {
      ...body,
      ...(stored ? { imageUrl: stored.url, imagePublicId: stored.publicId } : {}),
    });
    if (stored && current?.imagePublicId) await this.images.destroy(current.imagePublicId);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'banner', entityId: id });
    return banner;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const existing = await this.banners.remove(id);
    if (existing.imagePublicId) await this.images.destroy(existing.imagePublicId);
    await this.audit.record({ adminId: user.id, action: 'delete', entityType: 'banner', entityId: id });
    return { ok: true };
  }
}
