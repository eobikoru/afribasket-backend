import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlogModule } from '../blog/blog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AuthModule, InventoryModule, BlogModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
