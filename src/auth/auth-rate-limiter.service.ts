import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { Errors } from '../common/errors/app.exception';
import { RedisService } from '../redis/redis.service';

export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

@Injectable()
export class AuthRateLimiter {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async assertWithinLimit(ip: string, email?: string): Promise<void> {
    const auth = this.config.get('auth', { infer: true });
    await this.hit(`auth:ip:${ip || 'unknown'}`, auth.rateLimitMax, auth.rateLimitWindowSeconds);
    if (email) {
      await this.hit(`auth:email:${email.toLowerCase()}`, auth.rateLimitMax, auth.rateLimitWindowSeconds);
    }
  }

  async hit(key: string, limit: number, windowSeconds: number, store: RateLimitStore = this.redis): Promise<void> {
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, windowSeconds);
    const ttl = await store.ttl(key);
    if (ttl < 0) await store.expire(key, windowSeconds);
    if (count > limit) {
      throw Errors.tooMany('Too many attempts. Try again later.');
    }
  }
}
