import { Module, forwardRef } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';
import { PayPalClient } from './paypal.client';
import { StripePayments } from './stripe.payments';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [forwardRef(() => OrdersModule)],
  controllers: [WebhooksController],
  providers: [PayPalClient, StripePayments, PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
