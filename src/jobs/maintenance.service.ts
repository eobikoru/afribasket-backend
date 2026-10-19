import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { AppConfig } from '../config/configuration';
import { BlogService } from '../blog/blog.service';
import { NotificationService } from '../email/notification.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrderSettlementService } from '../orders/order-settlement.service';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly settlement: OrderSettlementService,
    private readonly blog: BlogService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationService,
  ) {}

  async releaseExpiredReservations(): Promise<number> {
    const released = await this.settlement.releaseExpiredReservations();
    if (released > 0) this.logger.log({ msg: 'reservations_released', released });
    return released;
  }

  async flushBlogViews(): Promise<number> {
    return this.blog.flushViews();
  }

  async dailyInventory(): Promise<void> {
    const lots = await this.inventory.expireDueLots();
    const low = await this.inventory.lowStock();
    const lines = [
      `Expired lots: ${lots.expired}`,
      'Lots inside 14 days of best-by:',
      ...lots.expiring.map((lot) => `- ${lot.productName} ${lot.lotCode} qty ${lot.quantity} best by ${lot.bestByDate.toISOString()}`),
      'Low stock:',
      ...low.products.map((row) => `- ${row.name} available ${row.quantityAvailable}`),
      ...low.variants.map((row) => `- ${row.name} / ${row.title} available ${row.quantityAvailable}`),
    ];
    await this.notifications.sendOpsDigest('AfriBasket inventory digest', lines.join('\n'));
  }
}

@Injectable()
export class JobScheduler implements OnModuleInit {
  constructor(
    @InjectQueue('maintenance') private readonly queue: Queue,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get('jobsEnabled', { infer: true })) return;
    await this.queue.add('release-reservations', {}, { repeat: { every: 5 * 60 * 1000 }, jobId: 'release-reservations' });
    await this.queue.add('flush-blog-views', {}, { repeat: { every: 60 * 1000 }, jobId: 'flush-blog-views' });
    await this.queue.add('daily-inventory', {}, { repeat: { pattern: '0 13 * * *' }, jobId: 'daily-inventory' });
  }
}
