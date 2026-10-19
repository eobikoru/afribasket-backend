import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BlogModule } from '../blog/blog.module';
import { EmailModule } from '../email/email.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { MaintenanceProcessor } from './maintenance.processor';
import { JobScheduler, MaintenanceService } from './maintenance.service';

const jobsEnabled = process.env.NODE_ENV !== 'test' && process.env.JOBS_ENABLED !== 'false';

@Module({
  imports: [
    OrdersModule,
    BlogModule,
    InventoryModule,
    EmailModule,
    ...(jobsEnabled ? [BullModule.registerQueue({ name: 'maintenance' })] : []),
  ],
  providers: [MaintenanceService, ...(jobsEnabled ? [MaintenanceProcessor, JobScheduler] : [])],
  exports: [MaintenanceService],
})
export class JobsModule {}

export function redisConnectionOptions(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}
