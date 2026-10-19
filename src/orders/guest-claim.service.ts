import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GuestOrderClaimService {
  constructor(private readonly prisma: PrismaService) {}

  /** Links guest orders once. Already-linked rows are excluded, so repeats are no-ops. */
  async claim(customerId: string, email: string): Promise<number> {
    const result = await this.prisma.order.updateMany({
      where: {
        customerId: null,
        email: email.toLowerCase(),
      },
      data: { customerId },
    });
    return result.count;
  }
}
