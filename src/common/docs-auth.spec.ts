import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { docsAuthMiddleware } from './docs-auth';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { Errors } from './errors/app.exception';

@Controller('probe')
class ProbeController {
  @Get('boom')
  boom() {
    throw Errors.conflict('Slug already exists', { field: 'slug' });
  }
}

describe('HTTP error shape and docs gate', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(docsAuthMiddleware('docs', undefined));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the standard error envelope', async () => {
    const response = await request(app.getHttpServer()).get('/probe/boom');
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Slug already exists',
        details: { field: 'slug' },
      },
    });
  });

  it('returns 404 for docs when DOCS_PASSWORD is unset', async () => {
    const response = await request(app.getHttpServer()).get('/docs');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('docs basic auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(docsAuthMiddleware('docs', 'secret'));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('asks for basic auth and accepts the configured user', async () => {
    const open = await request(app.getHttpServer()).get('/docs');
    expect(open.status).toBe(401);
    const authed = await request(app.getHttpServer()).get('/docs').auth('docs', 'secret');
    expect(authed.status).not.toBe(401);
  });
});
