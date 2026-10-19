import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppConfig } from '../config/configuration';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  ready = false;

  constructor(config: ConfigService<AppConfig, true>) {
    this.client = new Redis(config.get('redisUrl', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    this.client.on('error', (error) => {
      this.ready = false;
      this.logger.warn({ msg: 'redis_error', error: error.message });
    });
    this.client.on('ready', () => {
      this.ready = true;
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.ready = true;
    } catch (error) {
      this.ready = false;
      this.logger.error({
        msg: 'redis_connect_failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<string | null> {
    if (ttlSeconds == null) return this.client.set(key, value);
    return this.client.set(key, value, 'EX', ttlSeconds);
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.client.hincrby(key, field, increment);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async rename(source: string, destination: string): Promise<string> {
    return this.client.rename(source, destination);
  }
}
