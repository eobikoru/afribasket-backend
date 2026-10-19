import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config/configuration';
import { CART_COOKIE, REFRESH_COOKIE, clearCookie, setCookie } from '../common/cookies';
import { ApiZodBody } from '../common/swagger';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { forgotSchema, loginSchema, refreshSchema, registerSchema, resetSchema } from './auth.schemas';

@ApiTags('auth')
@Controller('auth')
export class CustomerAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Create an active customer account' })
  @ApiZodBody(registerSchema)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: ReturnType<typeof registerSchema.parse>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(body, this.meta(req, body.cartToken));
    this.setRefresh(res, result.refreshToken);
    return result;
  }

  @Post('login')
  @ApiOperation({ summary: 'Log in and claim guest orders for this email' })
  @ApiZodBody(loginSchema)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: ReturnType<typeof loginSchema.parse>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body, this.meta(req, body.cartToken ?? this.cartToken(req)));
    this.setRefresh(res, result.refreshToken);
    return result;
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new access token' })
  @ApiZodBody(refreshSchema)
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.refresh(body.refreshToken ?? req.cookies?.[REFRESH_COOKIE], this.meta(req));
    this.setRefresh(res, result.refreshToken);
    return result;
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { refreshToken?: string }) {
    const raw = body?.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
    const result = await this.auth.logout(raw);
    clearCookie(res, REFRESH_COOKIE, this.secure);
    return result;
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Send a password reset email if the account exists' })
  @ApiZodBody(forgotSchema)
  forgot(@Body(new ZodValidationPipe(forgotSchema)) body: { email: string }, @Req() req: Request) {
    return this.auth.forgotPassword(body.email, this.meta(req));
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Set a new password from a reset token' })
  @ApiZodBody(resetSchema)
  reset(@Body(new ZodValidationPipe(resetSchema)) body: { token: string; password: string }) {
    return this.auth.resetPassword(body.token, body.password);
  }

  private meta(req: Request, cartToken?: string) {
    return {
      ip: req.ip,
      userAgent: req.header('user-agent'),
      cartToken: cartToken ?? this.cartToken(req),
    };
  }

  private cartToken(req: Request): string | undefined {
    const header = req.header('x-cart-token');
    return header || req.cookies?.[CART_COOKIE];
  }

  private setRefresh(res: Response, token: string) {
    const days = this.config.get('jwt', { infer: true }).refreshTtlDays;
    setCookie(res, REFRESH_COOKIE, token, this.secure, days * 24 * 60 * 60 * 1000);
  }

  private get secure(): boolean {
    return this.config.get('nodeEnv', { infer: true }) === 'production';
  }
}
