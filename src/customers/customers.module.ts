import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCustomersController, CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [AuthModule],
  controllers: [CustomersController, AdminCustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
