import 'dotenv/config';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AdminsModule } from './admins/admins.module';
import { AuthModule } from './auth/auth.module';
import { BannersModule } from './banners/banners.module';
import { BlogModule } from './blog/blog.module';
import { CartModule } from './cart/cart.module';
import { CatalogModule } from './catalog/catalog.module';
import { configuration } from './config/configuration';
import { validateEnv } from './config/env.schema';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CouponsModule } from './coupons/coupons.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { JobsModule, redisConnectionOptions } from './jobs/jobs.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SettingsModule } from './settings/settings.module';

const jobsEnabled = process.env.NODE_ENV !== 'test' && process.env.JOBS_ENABLED !== 'false';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    ...(jobsEnabled
      ? [BullModule.forRoot({ connection: redisConnectionOptions(process.env.REDIS_URL || 'redis://127.0.0.1:6379') })]
      : []),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    CustomersModule,
    AdminsModule,
    CatalogModule,
    InventoryModule,
    CartModule,
    SettingsModule,
    CouponsModule,
    OrdersModule,
    PaymentsModule,
    BannersModule,
    BlogModule,
    ReviewsModule,
    DashboardModule,
    JobsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
