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
import { bannerSchema, BannersService } from './banners.service';

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
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(bannerSchema)) body: z.infer<typeof bannerSchema>) {
    const banner = await this.banners.create(body);
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'banner', entityId: banner.id });
    return banner;
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw Errors.badRequest('Image file is required');
    return this.images.upload(file.buffer, 'banners');
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bannerSchema.partial())) body: Partial<z.infer<typeof bannerSchema>>,
  ) {
    const banner = await this.banners.update(id, body);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'banner', entityId: id });
    return banner;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.banners.remove(id);
    await this.audit.record({ adminId: user.id, action: 'delete', entityType: 'banner', entityId: id });
    return result;
  }
}
