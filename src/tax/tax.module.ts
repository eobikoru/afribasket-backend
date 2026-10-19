import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { TaxService } from './tax.service';

@Module({
  imports: [SettingsModule],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
