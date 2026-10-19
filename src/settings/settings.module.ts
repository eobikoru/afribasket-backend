import { Module } from '@nestjs/common';
import { AdminsModule } from '../admins/admins.module';
import { AuthModule } from '../auth/auth.module';
import { AdminSettingsController, SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [AuthModule, AdminsModule],
  controllers: [SettingsController, AdminSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
