import { randomUUID } from 'crypto';
import { Body, Controller, Delete, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { OptionalCustomerGuard } from '../auth/guards';
import type { AuthUser } from '../auth/auth.types';
import type { AppConfig } from '../config/configuration';
import { CART_COOKIE, CART_HEADER, setCookie } from '../common/cookies';
import { Errors } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ApiZodBody } from '../common/swagger';
import { z } from 'zod';
import { CartService } from './cart.service';

const lineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(),
  quantity: z.number().int().min(1).max(100),
});

const updateSchema = lineSchema;

@ApiTags('cart')
@Controller('cart')
@UseGuards(OptionalCustomerGuard)
export class CartController {
  constructor(
    private readonly carts: CartService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get the current cart with server-priced lines' })
  get(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const identity = this.identity(req, res);
    return identity.customerId ? this.carts.getCustomer(identity.customerId) : this.carts.getGuest(identity.token);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add a line or increase its quantity' })
  @ApiZodBody(lineSchema)
  add(
    @Body(new ZodValidationPipe(lineSchema)) body: z.infer<typeof lineSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const identity = this.identity(req, res);
    return identity.customerId ? this.carts.addCustomer(identity.customerId, body) : this.carts.addGuest(identity.token, body);
  }

  @Patch('items')
  @ApiOperation({ summary: 'Set a line quantity' })
  @ApiZodBody(updateSchema)
  update(
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const identity = this.identity(req, res);
    const variantId = body.variantId ?? null;
    return identity.customerId
      ? this.carts.updateCustomer(identity.customerId, body.productId, variantId, body.quantity)
      : this.carts.updateGuest(identity.token, body.productId, variantId, body.quantity);
  }

  @Delete('items')
  @ApiOperation({ summary: 'Remove a line' })
  remove(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const productId = String(req.query.productId ?? '');
    if (!productId) throw Errors.badRequest('productId is required');
    const variantId = req.query.variantId ? String(req.query.variantId) : null;
    const identity = this.identity(req, res);
    return identity.customerId
      ? this.carts.removeCustomer(identity.customerId, productId, variantId)
      : this.carts.removeGuest(identity.token, productId, variantId);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear the cart' })
  clear(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const identity = this.identity(req, res);
    return identity.customerId ? this.carts.clearCustomer(identity.customerId) : this.carts.clearGuest(identity.token);
  }

  private identity(req: Request, res: Response): { customerId?: string; token: string } {
    const user = (req as Request & { user?: AuthUser }).user;
    const existing = req.header(CART_HEADER) || req.cookies?.[CART_COOKIE];
    const token = existing || randomUUID();
    if (!existing) {
      setCookie(res, CART_COOKIE, token, this.config.get('nodeEnv', { infer: true }) === 'production', 30 * 86400000);
      res.setHeader(CART_HEADER, token);
    }
    return { customerId: user?.type === 'customer' ? user.id : undefined, token };
  }
}
