import { Controller, Get, INestApplication, Injectable, type CanActivate, type ExecutionContext, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { Errors } from '../common/errors/app.exception';
import { Roles } from './decorators';
import { RolesGuard } from './guards';

@Injectable()
class HeaderUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ header: (name: string) => string | undefined; user?: unknown }>();
    const raw = req.header('x-user');
    if (!raw) throw Errors.unauthorized();
    req.user = JSON.parse(raw) as unknown;
    return true;
  }
}

@Controller('guarded')
@UseGuards(HeaderUserGuard, RolesGuard)
class GuardedController {
  @Get('catalog')
  @Roles('SUPER_ADMIN', 'ADMIN')
  catalog() {
    return { ok: true };
  }

  @Get('blog')
  @Roles('SUPER_ADMIN', 'ADMIN', 'BLOG_AUTHOR')
  blog() {
    return { ok: true };
  }

  @Get('admins')
  @Roles('SUPER_ADMIN')
  admins() {
    return { ok: true };
  }
}

describe('admin role guards', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GuardedController],
      providers: [RolesGuard, HeaderUserGuard],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const user = (role: string) => JSON.stringify({ id: 'a1', type: 'admin', email: 'ops@example.com', role });

  it('rejects an anonymous request', async () => {
    const response = await request(app.getHttpServer()).get('/guarded/catalog');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('lets an admin manage catalog and keeps a blog author out', async () => {
    const author = await request(app.getHttpServer()).get('/guarded/catalog').set('x-user', user('BLOG_AUTHOR'));
    const admin = await request(app.getHttpServer()).get('/guarded/catalog').set('x-user', user('ADMIN'));
    expect(author.status).toBe(403);
    expect(admin.status).toBe(200);
  });

  it('lets a blog author write blog content and reserves admin management for super admins', async () => {
    const blog = await request(app.getHttpServer()).get('/guarded/blog').set('x-user', user('BLOG_AUTHOR'));
    const admins = await request(app.getHttpServer()).get('/guarded/admins').set('x-user', user('ADMIN'));
    const superAdmin = await request(app.getHttpServer()).get('/guarded/admins').set('x-user', user('SUPER_ADMIN'));
    expect(blog.status).toBe(200);
    expect(admins.status).toBe(403);
    expect(superAdmin.body).toEqual({ ok: true });
  });
});
