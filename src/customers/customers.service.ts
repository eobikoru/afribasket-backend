import { Injectable } from '@nestjs/common';
import type { Address } from '@prisma/client';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { publicCustomer } from '../auth/auth.service';
import type { UsAddress } from '../common/address';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async get(customerId: string) {
    const customer = await this.require(customerId);
    return publicCustomer(customer);
  }

  async update(
    customerId: string,
    input: {
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      marketingOptIn?: boolean;
      defaultAddressId?: string | null;
    },
  ) {
    if (input.defaultAddressId) {
      const address = await this.prisma.address.findFirst({
        where: { id: input.defaultAddressId, customerId },
      });
      if (!address) throw Errors.notFound('Address not found');
    }
    const customer = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone === undefined ? undefined : input.phone,
        marketingOptIn: input.marketingOptIn,
        defaultAddressId: input.defaultAddressId === undefined ? undefined : input.defaultAddressId,
      },
    });
    return publicCustomer(customer);
  }

  async listAddresses(customerId: string) {
    const rows = await this.prisma.address.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
    return rows.map(publicAddress);
  }

  async createAddress(customerId: string, input: UsAddress & { label?: string }, makeDefault = false) {
    const address = await this.prisma.address.create({
      data: { ...input, country: 'US', customerId },
    });
    const customer = await this.require(customerId);
    if (makeDefault || !customer.defaultAddressId) {
      await this.prisma.customer.update({ where: { id: customerId }, data: { defaultAddressId: address.id } });
    }
    return publicAddress(address);
  }

  async updateAddress(customerId: string, addressId: string, input: Partial<UsAddress> & { label?: string }) {
    await this.requireAddress(customerId, addressId);
    const address = await this.prisma.address.update({
      where: { id: addressId },
      data: { ...input, country: 'US' },
    });
    return publicAddress(address);
  }

  async deleteAddress(customerId: string, addressId: string) {
    await this.requireAddress(customerId, addressId);
    const customer = await this.require(customerId);
    if (customer.defaultAddressId === addressId) {
      await this.prisma.customer.update({ where: { id: customerId }, data: { defaultAddressId: null } });
    }
    await this.prisma.address.delete({ where: { id: addressId } });
    return { ok: true };
  }

  async listForAdmin(query: { page: number; perPage: number; q?: string }) {
    const where = query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: 'insensitive' as const } },
            { firstName: { contains: query.q, mode: 'insensitive' as const } },
            { lastName: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);
    return { items: rows.map(publicCustomer), page: query.page, perPage: query.perPage, total };
  }

  async getForAdmin(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, include: { addresses: true, orders: { take: 10, orderBy: { createdAt: 'desc' } } } });
    if (!customer) throw Errors.notFound('Customer not found');
    return {
      ...publicCustomer(customer),
      addresses: customer.addresses.map(publicAddress),
      recentOrders: customer.orders.map((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalCents: order.totalCents,
        createdAt: order.createdAt,
      })),
    };
  }

  private async require(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw Errors.unauthorized();
    return customer;
  }

  private async requireAddress(customerId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({ where: { id: addressId, customerId } });
    if (!address) throw Errors.notFound('Address not found');
    return address;
  }
}

export function publicAddress(address: Address) {
  return {
    id: address.id,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    phone: address.phone,
    label: address.label,
  };
}
