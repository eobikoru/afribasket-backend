import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  ready = false;

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.ready = true;
    } catch (error) {
      this.ready = false;
      this.logger.error({ msg: 'postgres_connect_failed', error: error instanceof Error ? error.message : 'unknown' });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
