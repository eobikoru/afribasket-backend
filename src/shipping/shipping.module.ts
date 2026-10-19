import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ShippingService } from './shipping.service';

@Module({
  imports: [SettingsModule],
  providers: [ShippingService],
  exports: [ShippingService, SettingsModule],
})
export class ShippingModule {}
