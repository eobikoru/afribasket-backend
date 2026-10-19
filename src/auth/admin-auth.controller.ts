import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config/configuration';
import { REFRESH_COOKIE, clearCookie, setCookie } from '../common/cookies';
import { ApiZodBody } from '../common/swagger';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { adminLoginSchema, refreshSchema } from './auth.schemas';
import { AuthService } from './auth.service';

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Admin login' })
  @ApiZodBody(adminLoginSchema)
  async login(
    @Body(new ZodValidationPipe(adminLoginSchema)) body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.adminLogin(body, { ip: req.ip, userAgent: req.header('user-agent') });
    const days = this.config.get('jwt', { infer: true }).refreshTtlDays;
    setCookie(res, REFRESH_COOKIE, result.refreshToken, this.config.get('nodeEnv', { infer: true }) === 'production', days * 86400000);
    return result;
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate an admin refresh token' })
  @ApiZodBody(refreshSchema)
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.refresh(body.refreshToken ?? req.cookies?.[REFRESH_COOKIE], {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    const days = this.config.get('jwt', { infer: true }).refreshTtlDays;
    setCookie(res, REFRESH_COOKIE, result.refreshToken, this.config.get('nodeEnv', { infer: true }) === 'production', days * 86400000);
    return result;
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current admin refresh token' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { refreshToken?: string }) {
    const result = await this.auth.logout(body?.refreshToken ?? req.cookies?.[REFRESH_COOKIE]);
    clearCookie(res, REFRESH_COOKIE, this.config.get('nodeEnv', { infer: true }) === 'production');
    return result;
  }
}
