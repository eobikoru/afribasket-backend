import { Module, forwardRef } from '@nestjs/common';
import { AdminsModule } from '../admins/admins.module';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { CouponsModule } from '../coupons/coupons.module';
import { EmailModule } from '../email/email.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { ShippingModule } from '../shipping/shipping.module';
import { TaxModule } from '../tax/tax.module';
import { CheckoutService } from './checkout.service';
import { AdminOrdersController, OrdersController } from './orders.controller';
import { OrderSettlementService } from './order-settlement.service';
import { OrdersService } from './orders.service';
import { PricingService } from './pricing.service';

@Module({
  imports: [
    forwardRef(() => PaymentsModule),
    AuthModule,
    AdminsModule,
    CartModule,
    CouponsModule,
    EmailModule,
    InventoryModule,
    ShippingModule,
    TaxModule,
  ],
  controllers: [OrdersController, AdminOrdersController],
  providers: [PricingService, CheckoutService, OrderSettlementService, OrdersService],
  exports: [OrderSettlementService, CheckoutService, OrdersService],
})
export class OrdersModule {}
