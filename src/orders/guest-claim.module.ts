import { Module } from '@nestjs/common';
import { GuestOrderClaimService } from './guest-claim.service';

@Module({
  providers: [GuestOrderClaimService],
  exports: [GuestOrderClaimService],
})
export class GuestClaimModule {}
