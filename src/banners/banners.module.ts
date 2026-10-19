import { Module } from '@nestjs/common';
import { AdminsModule } from '../admins/admins.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminBannersController, BannersController } from './banners.controller';
import { BannersService } from './banners.service';

@Module({
  imports: [AuthModule, AdminsModule, CatalogModule],
  controllers: [BannersController, AdminBannersController],
  providers: [BannersService],
  exports: [BannersService],
})
export class BannersModule {}
