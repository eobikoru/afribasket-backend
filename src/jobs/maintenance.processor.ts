import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MaintenanceService } from './maintenance.service';

@Processor('maintenance')
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(private readonly maintenance: MaintenanceService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'release-reservations') return this.maintenance.releaseExpiredReservations();
    if (job.name === 'flush-blog-views') return this.maintenance.flushBlogViews();
    if (job.name === 'daily-inventory') return this.maintenance.dailyInventory();
    this.logger.warn({ msg: 'unknown_job', name: job.name });
    return null;
  }
}
