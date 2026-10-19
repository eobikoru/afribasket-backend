import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../admins/admins.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard, OptionalCustomerGuard, RolesGuard } from '../auth/guards';
import { CART_COOKIE, CART_HEADER } from '../common/cookies';
import { Errors } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { paginationSchema } from '../common/pagination';
import { ApiFilterQuery, ApiZodBody, PAGE_QUERIES } from '../common/swagger';
import { CartService } from '../cart/cart.service';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutService } from './checkout.service';
import { OrdersService } from './orders.service';
import {
  adminOrderQuery,
  authCheckoutSchema,
  breakdownSchema,
  guestCheckoutSchema,
  noteSchema,
  refundSchema,
  returnStockSchema,
  statusSchema,
  trackingSchema,
  trackSchema,
  verifySchema,
} from './orders.schemas';
import { PaymentsService } from '../payments/payments.service';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly checkoutFlow: CheckoutService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly carts: CartService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('breakdown')
  @UseGuards(OptionalCustomerGuard)
  @ApiOperation({ summary: 'Price lines, shipping, tax, and an optional coupon' })
  @ApiZodBody(breakdownSchema)
  async breakdown(
    @Body(new ZodValidationPipe(breakdownSchema)) body: z.infer<typeof breakdownSchema>,
    @Req() req: Request,
  ) {
    const user = (req as Request & { user?: AuthUser }).user;
    const lines = await this.lines(body.lines, body.useCart, user, req);
    return this.checkoutFlow.breakdown({
      lines,
      address: body.shippingAddress,
      shippingMethod: body.shippingMethod,
      couponCode: body.couponCode,
      customerId: user?.type === 'customer' ? user.id : undefined,
      email: body.email ?? (user?.type === 'customer' ? user.email : undefined),
    });
  }

  @Post('checkout/guest')
  @UseGuards(OptionalCustomerGuard)
  @ApiOperation({ summary: 'Guest checkout' })
  @ApiZodBody(guestCheckoutSchema)
  async guest(
    @Body(new ZodValidationPipe(guestCheckoutSchema)) body: z.infer<typeof guestCheckoutSchema>,
    @Req() req: Request,
  ) {
    const lines = await this.lines(body.lines, body.useCart, undefined, req);
    const token = req.header(CART_HEADER) || req.cookies?.[CART_COOKIE];
    return this.checkoutFlow.checkout(
      {
        lines,
        email: body.email,
        customerName: `${body.firstName} ${body.lastName}`,
        phone: body.phone,
        shippingAddress: body.shippingAddress,
        billingAddress: body.billingSameAsShipping || !body.billingAddress ? body.shippingAddress : body.billingAddress,
        shippingMethod: body.shippingMethod,
        couponCode: body.couponCode,
        paymentProvider: body.paymentProvider,
        deliveryNote: body.deliveryNote,
        substitutionPreference: body.substitutionPreference,
        clearCart: body.useCart || !body.lines ? { guestToken: token } : undefined,
      },
      this.payments,
    );
  }

  @Post('checkout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Checkout for a signed-in customer' })
  @ApiZodBody(authCheckoutSchema)
  async checkout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(authCheckoutSchema)) body: z.infer<typeof authCheckoutSchema>,
    @Req() req: Request,
  ) {
    if (user.type !== 'customer') throw Errors.forbidden('Customer login required');
    const customer = await this.prisma.customer.findUnique({ where: { id: user.id } });
    if (!customer) throw Errors.unauthorized();
    const address = body.addressId
      ? await this.prisma.address.findFirst({ where: { id: body.addressId, customerId: user.id } })
      : null;
    if (body.addressId && !address) throw Errors.notFound('Address not found');
    const shippingAddress = address
      ? {
          line1: address.line1,
          line2: address.line2 ?? undefined,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
          country: 'US' as const,
          phone: address.phone ?? undefined,
        }
      : body.shippingAddress;
    if (!shippingAddress) throw Errors.badRequest('Choose a saved address or enter a shipping address');
    const lines = await this.lines(body.lines, body.useCart ?? !body.lines, user, req);
    return this.checkoutFlow.checkout(
      {
        lines,
        email: customer.email,
        customerName: `${customer.firstName} ${customer.lastName}`,
        phone: body.phone ?? customer.phone ?? shippingAddress.phone,
        customerId: customer.id,
        shippingAddress,
        billingAddress: body.billingSameAsShipping || !body.billingAddress ? shippingAddress : body.billingAddress,
        shippingMethod: body.shippingMethod,
        couponCode: body.couponCode,
        paymentProvider: body.paymentProvider,
        deliveryNote: body.deliveryNote,
        substitutionPreference: body.substitutionPreference,
        clearCart: { customerId: customer.id },
      },
      this.payments,
    );
  }

  @Post('checkout/verify')
  @ApiOperation({ summary: 'Confirm payment status after redirect. The webhook remains the source of truth.' })
  @ApiZodBody(verifySchema)
  verify(@Body(new ZodValidationPipe(verifySchema)) body: z.infer<typeof verifySchema>) {
    return this.payments.verify(body.orderNumber, body.providerReference);
  }

  @Post('track')
  @ApiOperation({ summary: 'Look up an order with its number plus email or phone' })
  @ApiZodBody(trackSchema)
  track(@Body(new ZodValidationPipe(trackSchema)) body: z.infer<typeof trackSchema>) {
    return this.orders.track(body.orderNumber, body.email, body.phone);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Order history for the signed-in customer' })
  @ApiFilterQuery(PAGE_QUERIES)
  mine(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(paginationSchema)) query: z.infer<typeof paginationSchema>) {
    if (user.type !== 'customer') throw Errors.forbidden('Customer login required');
    return this.orders.listMine(user.id, query.page, query.perPage);
  }

  @Get(':orderNumber')
  @UseGuards(OptionalCustomerGuard)
  @ApiOperation({ summary: 'Order detail for the owner or a guest who proves the email' })
  get(@Param('orderNumber') orderNumber: string, @Query('email') email: string | undefined, @Req() req: Request) {
    const user = (req as Request & { user?: AuthUser }).user;
    return this.orders.getOwned(orderNumber, user?.type === 'customer' ? user.id : undefined, email);
  }

  private async lines(
    explicit: Array<{ productId: string; variantId?: string | null; quantity: number }> | undefined,
    useCart: boolean | undefined,
    user: AuthUser | undefined,
    req: Request,
  ) {
    if (explicit && explicit.length > 0 && !useCart) return explicit;
    if (user?.type === 'customer') return this.carts.linesForCustomer(user.id);
    const token = req.header(CART_HEADER) || req.cookies?.[CART_COOKIE];
    if (!token) throw Errors.badRequest('Add items or provide a cart token');
    const lines = await this.carts.linesForGuest(token);
    if (lines.length === 0) throw Errors.badRequest('Your cart is empty');
    return lines;
  }
}

@ApiTags('admin-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Filter orders by status, payment, provider, date, or search' })
  @ApiFilterQuery([
    ...PAGE_QUERIES,
    { name: 'status', description: 'pending, processing, shipped, delivered, cancelled, refunded' },
    { name: 'paymentStatus', description: 'pending, completed, failed, refunded, partially_refunded' },
    { name: 'provider', description: 'stripe or paypal' },
    { name: 'from', description: 'ISO start datetime' },
    { name: 'to', description: 'ISO end datetime' },
    { name: 'q', description: 'Order number or email' },
    { name: 'sort', description: 'newest, oldest, total_desc, total_asc' },
  ])
  list(@Query(new ZodValidationPipe(adminOrderQuery)) query: z.infer<typeof adminOrderQuery>) {
    return this.orders.adminList(query);
  }

  @Get(':orderNumber')
  get(@Param('orderNumber') orderNumber: string) {
    return this.orders.adminGet(orderNumber);
  }

  @Post(':orderNumber/status')
  async status(
    @CurrentUser() user: AuthUser,
    @Param('orderNumber') orderNumber: string,
    @Body(new ZodValidationPipe(statusSchema)) body: z.infer<typeof statusSchema>,
  ) {
    const order = await this.orders.updateStatus(orderNumber, body.status, user.id);
    await this.audit.record({ adminId: user.id, action: 'status_change', entityType: 'order', entityId: orderNumber, metadata: body });
    return order;
  }

  @Post(':orderNumber/tracking')
  async tracking(
    @CurrentUser() user: AuthUser,
    @Param('orderNumber') orderNumber: string,
    @Body(new ZodValidationPipe(trackingSchema)) body: z.infer<typeof trackingSchema>,
  ) {
    const order = await this.orders.setTracking(orderNumber, body.carrier, body.trackingNumber);
    await this.audit.record({ adminId: user.id, action: 'status_change', entityType: 'order', entityId: orderNumber, metadata: body });
    return order;
  }

  @Post(':orderNumber/notes')
  async note(
    @CurrentUser() user: AuthUser,
    @Param('orderNumber') orderNumber: string,
    @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>,
  ) {
    return this.orders.addNote(orderNumber, user.id, body.body, body.isInternal);
  }

  @Post(':orderNumber/refund')
  async refund(
    @CurrentUser() user: AuthUser,
    @Param('orderNumber') orderNumber: string,
    @Body(new ZodValidationPipe(refundSchema)) body: z.infer<typeof refundSchema>,
  ) {
    const order = await this.orders.refund(orderNumber, body.amountCents);
    await this.audit.record({ adminId: user.id, action: 'refund', entityType: 'order', entityId: orderNumber, metadata: body });
    return order;
  }

  @Post(':orderNumber/return-stock')
  async returnStock(
    @CurrentUser() user: AuthUser,
    @Param('orderNumber') orderNumber: string,
    @Body(new ZodValidationPipe(returnStockSchema)) body: z.infer<typeof returnStockSchema>,
  ) {
    const order = await this.orders.returnStock(orderNumber, user.id, body.items);
    await this.audit.record({ adminId: user.id, action: 'stock_adjustment', entityType: 'order', entityId: orderNumber, metadata: body });
    return order;
  }
}
