import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admins/admins.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SettingsService, settingsUpdateSchema } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  publicSettings() {
    return this.settings.publicView();
  }
}

@ApiTags('admin-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Patch()
  async update(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(settingsUpdateSchema)) body: z.infer<typeof settingsUpdateSchema>) {
    const settings = await this.settings.update(body);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'settings', entityId: 'default' });
    return settings;
  }
}
