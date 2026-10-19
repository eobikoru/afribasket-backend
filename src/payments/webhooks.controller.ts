import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Errors } from '../common/errors/app.exception';
import { PaymentsService } from './payments.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('stripe')
  @ApiExcludeEndpoint()
  stripe(@Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string | string[] | undefined>) {
    if (!req.rawBody) throw Errors.badRequest('Missing raw body');
    return this.payments.handleStripe(headers, req.rawBody);
  }

  @Post('paypal')
  @ApiExcludeEndpoint()
  paypal(@Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string | string[] | undefined>) {
    if (!req.rawBody) throw Errors.badRequest('Missing raw body');
    return this.payments.handlePayPal(headers, req.rawBody);
  }
}
