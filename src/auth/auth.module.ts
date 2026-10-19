import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { CartModule } from '../cart/cart.module';
import { EmailModule } from '../email/email.module';
import { GuestClaimModule } from '../orders/guest-claim.module';
import { AdminAuthController } from './admin-auth.controller';
import { AuthRateLimiter } from './auth-rate-limiter.service';
import { AuthService } from './auth.service';
import { CustomerAuthController } from './customer-auth.controller';
import { JwtAuthGuard, OptionalCustomerGuard, RolesGuard } from './guards';
import { JwtAuthModule } from './jwt-auth.module';
import { JwtStrategy } from './jwt.strategy';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtAuthModule, PassportModule.register({ defaultStrategy: 'jwt' }), EmailModule, CartModule, GuestClaimModule],
  controllers: [CustomerAuthController, AdminAuthController],
  providers: [AuthService, PasswordService, TokenService, AuthRateLimiter, JwtStrategy, JwtAuthGuard, RolesGuard, OptionalCustomerGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard, OptionalCustomerGuard, PasswordService],
})
export class AuthModule {}
