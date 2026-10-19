import { AuthRateLimiter, type RateLimitStore } from './auth-rate-limiter.service';

class MemoryLimit implements RateLimitStore {
  private readonly counts = new Map<string, number>();
  private readonly ttls = new Map<string, number>();

  async incr(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.ttls.set(key, seconds);
    return 1;
  }

  async ttl(key: string): Promise<number> {
    return this.ttls.get(key) ?? -1;
  }
}

describe('auth rate limiter', () => {
  function limiter(store: MemoryLimit) {
    return new AuthRateLimiter(store as never, {
      get: () => ({ rateLimitMax: 2, rateLimitWindowSeconds: 60 }),
    } as never);
  }

  it('allows the configured number of attempts and then rejects the next one', async () => {
    const store = new MemoryLimit();
    const service = limiter(store);
    await service.assertWithinLimit('203.0.113.8', 'ada@example.com');
    await service.assertWithinLimit('203.0.113.8', 'ada@example.com');
    await expect(service.assertWithinLimit('203.0.113.8', 'ada@example.com')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('limits an email independently of the calling IP', async () => {
    const store = new MemoryLimit();
    const service = limiter(store);
    await service.assertWithinLimit('203.0.113.1', 'Ada@Example.com');
    await service.assertWithinLimit('203.0.113.2', 'ada@example.com');
    await expect(service.assertWithinLimit('203.0.113.3', 'ada@example.com')).rejects.toMatchObject({ status: 429 });
  });
});
