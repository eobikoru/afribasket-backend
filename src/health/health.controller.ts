import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Process liveness' })
  @ApiOkResponse({ description: 'Process is running' })
  live() {
    return {
      status: 'ok',
      service: 'afribasket-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness of Postgres and Redis' })
  async ready() {
    const checks = { postgres: 'down', redis: 'down' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = 'up';
    } catch {
      checks.postgres = 'down';
    }
    try {
      const pong = await this.redis.ping();
      checks.redis = pong === 'PONG' ? 'up' : 'down';
    } catch {
      checks.redis = 'down';
    }
    if (checks.postgres !== 'up' || checks.redis !== 'up') {
      throw Errors.unavailable('Dependencies are not ready', checks);
    }
    return { status: 'ok', checks };
  }
}
