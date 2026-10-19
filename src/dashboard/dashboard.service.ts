import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { BlogService } from '../blog/blog.service';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly blog: BlogService,
  ) {}

  async summary(from?: string, to?: string) {
    const start = startOfUtcDay(new Date());
    const end = new Date(start.getTime() + 86400000);
    const rangeStart = from ? new Date(from) : new Date(start.getTime() - 29 * 86400000);
    const rangeEnd = to ? new Date(to) : end;
    const [productCount, ordersToday, ordersTotal, customers, paidOrders, statusGroups, inventoryCounts, blogCounts, expiring] =
      await Promise.all([
        this.prisma.product.count(),
        this.prisma.order.count({ where: { createdAt: { gte: start, lt: end } } }),
        this.prisma.order.count(),
        this.prisma.customer.count(),
        this.prisma.order.findMany({
          where: { paidAt: { not: null }, paymentStatus: { in: [PaymentStatus.completed, PaymentStatus.partially_refunded, PaymentStatus.refunded] } },
          select: { totalCents: true, refundedCents: true, paidAt: true, paymentProvider: true, paymentStatus: true },
        }),
        this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
        this.inventory.counts(),
        this.blog.counts(),
        this.inventory.listLots({ expiringWithinDays: 14 }),
      ]);
    const low = await this.inventory.lowStock();
    const net = (order: { totalCents: number; refundedCents: number }) => order.totalCents - order.refundedCents;
    const revenueTotal = paidOrders.reduce((sum, order) => sum + net(order), 0);
    const revenueToday = paidOrders
      .filter((order) => order.paidAt && order.paidAt >= start && order.paidAt < end)
      .reduce((sum, order) => sum + net(order), 0);
    const paid = paidOrders.filter((order) => order.paymentStatus !== PaymentStatus.refunded).length;
    const unpaid = await this.prisma.order.count({ where: { paymentStatus: { in: [PaymentStatus.pending, PaymentStatus.failed] } } });
    const trend = new Map<string, number>();
    for (const order of paidOrders) {
      if (!order.paidAt || order.paidAt < rangeStart || order.paidAt >= rangeEnd) continue;
      const day = order.paidAt.toISOString().slice(0, 10);
      trend.set(day, (trend.get(day) ?? 0) + net(order));
    }
    const paymentMix = { stripe: 0, paypal: 0 };
    for (const order of paidOrders) paymentMix[order.paymentProvider] += 1;
    return {
      products: productCount,
      ordersToday,
      ordersTotal,
      customers,
      revenueTodayCents: revenueToday,
      revenueTotalCents: revenueTotal,
      paidOrders: paid,
      unpaidOrders: unpaid,
      revenueTrend: [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, revenueCents]) => ({ day, revenueCents })),
      orderStatus: statusGroups.map((row) => ({ status: row.status, count: row._count._all })),
      lowStock: { products: low.products.length, variants: low.variants.length, items: [...low.products, ...low.variants].slice(0, 20) },
      expiringLots: expiring.slice(0, 20),
      paymentMix,
      inventory: inventoryCounts,
      blog: blogCounts.map((row) => ({ status: row.status, count: row._count._all })),
    };
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
