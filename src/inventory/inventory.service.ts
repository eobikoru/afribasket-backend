import { Injectable, Logger } from '@nestjs/common';
import { AdjustmentReason, Prisma, StockMovementType } from '@prisma/client';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { allocateFefo, InsufficientLotQuantityError } from './fefo';
import { deriveStock } from './stock-status';

type Tx = Prisma.TransactionClient;

export interface ReservationLine {
  orderItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  requiresLot: boolean;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { inventory: true, variants: true },
    });
    if (!product) throw Errors.notFound('Product not found');
    return {
      productId,
      inventory: product.inventory ? { ...product.inventory, ...deriveStock(product.inventory) } : null,
      variants: product.variants.map((variant) => ({ ...variant, ...deriveStock(variant) })),
    };
  }

  async updateRecord(
    productId: string,
    input: {
      variantId?: string | null;
      quantityIncoming?: number;
      lowStockThreshold?: number;
      reorderPoint?: number;
      reorderQuantity?: number;
      warehouseLocation?: string | null;
      notes?: string | null;
    },
  ) {
    if (input.variantId) {
      const variant = await this.prisma.productVariant.findFirst({ where: { id: input.variantId, productId } });
      if (!variant) throw Errors.notFound('Variant not found');
      const updated = await this.prisma.productVariant.update({ where: { id: variant.id }, data: input });
      return { ...updated, ...deriveStock(updated) };
    }
    const inventory = await this.prisma.inventory.findUnique({ where: { productId } });
    if (!inventory) throw Errors.conflict('This product tracks stock on its pack sizes');
    const updated = await this.prisma.inventory.update({ where: { id: inventory.id }, data: input });
    return { ...updated, ...deriveStock(updated) };
  }

  async adjust(
    adminId: string,
    input: { productId: string; variantId?: string | null; delta: number; reason: AdjustmentReason; note?: string; lotId?: string },
  ) {
    if (!Number.isInteger(input.delta) || input.delta === 0) throw Errors.badRequest('Delta must be a non-zero integer');
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: input.productId } });
      if (!product) throw Errors.notFound('Product not found');
      const requiresLot = product.perishable || product.storageType === 'frozen';
      if (requiresLot && !input.lotId) throw Errors.badRequest('Perishable and frozen stock changes require a lot');
      await this.lockStock(tx, input.productId, input.variantId ?? null);
      const current = await this.readAvailable(tx, input.productId, input.variantId ?? null);
      if (current + input.delta < 0) throw Errors.conflict('Adjustment would make available stock negative');
      await this.addAvailable(tx, input.productId, input.variantId ?? null, input.delta, {
        count: input.reason === 'inventory_count',
      });
      if (input.lotId) {
        const lot = await tx.foodLot.findFirst({ where: { id: input.lotId, productId: input.productId } });
        if (!lot) throw Errors.notFound('Lot not found');
        if (lot.quantity + input.delta < 0) throw Errors.conflict('Adjustment would make the lot quantity negative');
        await tx.foodLot.update({ where: { id: lot.id }, data: { quantity: { increment: input.delta } } });
      }
      const movement = await tx.stockMovement.create({
        data: {
          productId: input.productId,
          variantId: input.variantId,
          type: input.reason === 'damaged' ? StockMovementType.damage : StockMovementType.adjustment,
          delta: input.delta,
          reason: input.reason,
          note: input.note,
          adminId,
        },
      });
      return movement;
    });
  }

  async receiveLot(input: {
    productId: string;
    variantId?: string | null;
    lotCode: string;
    quantity: number;
    bestByDate: Date;
    receivedAt?: Date;
    adminId: string;
  }) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw Errors.badRequest('Lot quantity must be positive');
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: input.productId }, include: { variants: true } });
      if (!product) throw Errors.notFound('Product not found');
      if (product.variants.length > 0 && !input.variantId) throw Errors.badRequest('Choose a pack size for this lot');
      if (input.variantId && !product.variants.some((variant) => variant.id === input.variantId)) {
        throw Errors.notFound('Variant not found');
      }
      const duplicate = await tx.foodLot.findFirst({
        where: { lotCode: input.lotCode, productId: input.productId, variantId: input.variantId ?? null },
      });
      if (duplicate) throw Errors.conflict('A lot with this code already exists for the product');
      const lot = await tx.foodLot.create({
        data: {
          productId: input.productId,
          variantId: input.variantId,
          lotCode: input.lotCode,
          quantity: input.quantity,
          bestByDate: input.bestByDate,
          receivedAt: input.receivedAt ?? new Date(),
        },
      });
      await this.addAvailable(tx, input.productId, input.variantId ?? null, input.quantity, { restock: true });
      await tx.stockMovement.create({
        data: {
          productId: input.productId,
          variantId: input.variantId,
          type: StockMovementType.purchase,
          delta: input.quantity,
          note: `Received lot ${input.lotCode}`,
          adminId: input.adminId,
        },
      });
      return lot;
    });
  }

  async listLots(query: { productId?: string; expiringWithinDays?: number }) {
    const now = new Date();
    const until = query.expiringWithinDays
      ? new Date(now.getTime() + query.expiringWithinDays * 86400000)
      : undefined;
    return this.prisma.foodLot.findMany({
      where: {
        productId: query.productId,
        ...(until ? { bestByDate: { lte: until }, expiredAt: null, quantity: { gt: 0 } } : {}),
      },
      orderBy: { bestByDate: 'asc' },
      include: { product: { select: { name: true, sku: true } }, variant: { select: { title: true, sku: true } } },
    });
  }

  async listMovements(query: { page: number; perPage: number; productId?: string }) {
    const where = query.productId ? { productId: query.productId } : {};
    const [total, items] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);
    return { items, page: query.page, perPage: query.perPage, total };
  }

  async lowStock() {
    const [inventoryIds, variantIds] = await Promise.all([
      this.prisma.$queryRaw<Array<{ productId: string }>>`
        SELECT "productId" FROM "Inventory" WHERE "quantityAvailable" <= "lowStockThreshold"`,
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "ProductVariant" WHERE "isActive" = true AND "quantityAvailable" <= "lowStockThreshold"`,
    ]);
    const [inventories, variants] = await Promise.all([
      this.prisma.inventory.findMany({
        where: { productId: { in: inventoryIds.map((row) => row.productId) } },
        include: { product: { select: { name: true, sku: true } } },
      }),
      this.prisma.productVariant.findMany({
        where: { id: { in: variantIds.map((row) => row.id) } },
        include: { product: { select: { name: true, sku: true } } },
      }),
    ]);
    return {
      products: inventories.map((row) => ({ ...row, ...deriveStock(row), name: row.product.name, sku: row.product.sku })),
      variants: variants.map((row) => ({ ...row, ...deriveStock(row), name: row.product.name })),
    };
  }

  async counts() {
    const [inventories, variants] = await Promise.all([
      this.prisma.inventory.findMany(),
      this.prisma.productVariant.findMany({ where: { isActive: true } }),
    ]);
    const rows = [...inventories, ...variants].map(deriveStock);
    return {
      inStock: rows.filter((row) => !row.isOutOfStock && !row.isLowStock).length,
      low: rows.filter((row) => row.isLowStock).length,
      out: rows.filter((row) => row.isOutOfStock).length,
    };
  }

  async reserveLines(tx: Tx, orderId: string, lines: ReservationLine[]): Promise<void> {
    const ordered = [...lines].sort((a, b) => (a.variantId ?? a.productId).localeCompare(b.variantId ?? b.productId));
    for (const line of ordered) {
      await this.lockStock(tx, line.productId, line.variantId);
      const available = await this.readAvailable(tx, line.productId, line.variantId);
      if (available < line.quantity) throw Errors.conflict(`Not enough stock for ${line.productId}`);
      await this.addAvailable(tx, line.productId, line.variantId, -line.quantity, { reserve: line.quantity });
      await tx.stockMovement.create({
        data: {
          productId: line.productId,
          variantId: line.variantId,
          type: StockMovementType.reservation,
          delta: -line.quantity,
          orderId,
          note: 'Checkout reservation',
        },
      });
      if (line.requiresLot) {
        if (line.variantId) {
          await tx.$queryRaw`SELECT id FROM "FoodLot" WHERE "variantId" = ${line.variantId} FOR UPDATE`;
        } else {
          await tx.$queryRaw`SELECT id FROM "FoodLot" WHERE "productId" = ${line.productId} AND "variantId" IS NULL FOR UPDATE`;
        }
        const lots = await tx.foodLot.findMany({
          where: {
            productId: line.productId,
            variantId: line.variantId,
            expiredAt: null,
            quantity: { gt: 0 },
          },
        });
        let allocations;
        try {
          allocations = allocateFefo(lots, line.quantity);
        } catch (error) {
          if (error instanceof InsufficientLotQuantityError) {
            throw Errors.conflict('Not enough unexpired lot quantity for this perishable item');
          }
          throw error;
        }
        for (const allocation of allocations) {
          await tx.foodLot.update({ where: { id: allocation.lotId }, data: { quantity: { decrement: allocation.take } } });
          await tx.orderItemLot.create({
            data: { orderItemId: line.orderItemId, lotId: allocation.lotId, quantity: allocation.take },
          });
        }
      }
    }
  }

  async releaseReservation(tx: Tx, orderId: string, note: string): Promise<boolean> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { lotAllocations: true } } },
    });
    if (!order || order.stockReturned || order.status !== 'pending') return false;
    for (const item of order.items) {
      await this.lockStock(tx, item.productId ?? '', item.variantId);
      const variantOrInventory = item.variantId
        ? await tx.productVariant.findUnique({ where: { id: item.variantId } })
        : await tx.inventory.findUnique({ where: { productId: item.productId ?? '' } });
      const reserved = variantOrInventory?.quantityReserved ?? 0;
      const quantity = Math.min(item.quantity, reserved);
      if (item.variantId) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { quantityReserved: { decrement: quantity }, quantityAvailable: { increment: quantity } },
        });
      } else if (item.productId) {
        await tx.inventory.update({
          where: { productId: item.productId },
          data: { quantityReserved: { decrement: quantity }, quantityAvailable: { increment: quantity } },
        });
      }
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          variantId: item.variantId,
          type: StockMovementType.release,
          delta: quantity,
          orderId,
          note,
        },
      });
      for (const allocation of item.lotAllocations) {
        await tx.foodLot.update({ where: { id: allocation.lotId }, data: { quantity: { increment: allocation.quantity } } });
      }
    }
    await tx.order.update({ where: { id: orderId }, data: { stockReturned: true } });
    return true;
  }

  async sellReserved(tx: Tx, orderId: string): Promise<void> {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw Errors.notFound('Order not found');
    for (const item of order.items) {
      await this.lockStock(tx, item.productId ?? '', item.variantId);
      if (item.variantId) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { quantityReserved: { decrement: item.quantity }, lastSaleAt: new Date() },
        });
      } else if (item.productId) {
        await tx.inventory.update({
          where: { productId: item.productId },
          data: { quantityReserved: { decrement: item.quantity }, lastSaleAt: new Date() },
        });
      }
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          variantId: item.variantId,
          type: StockMovementType.sale,
          delta: -item.quantity,
          orderId,
          note: 'Payment captured',
        },
      });
    }
  }

  async returnItems(
    tx: Tx,
    orderId: string,
    items: Array<{ orderItemId: string; quantity: number }>,
    note: string,
    adminId?: string,
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { lotAllocations: { include: { lot: true } } } } },
    });
    if (!order) throw Errors.notFound('Order not found');
    for (const request of items) {
      const item = order.items.find((row) => row.id === request.orderItemId);
      if (!item) throw Errors.notFound('Order item not found');
      const remaining = item.quantity - item.returnedQuantity;
      if (request.quantity < 1 || request.quantity > remaining) throw Errors.badRequest('Return quantity is invalid');
      if (item.variantId) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { quantityAvailable: { increment: request.quantity } },
        });
      } else if (item.productId) {
        await tx.inventory.update({
          where: { productId: item.productId },
          data: { quantityAvailable: { increment: request.quantity } },
        });
      }
      await tx.orderItem.update({
        where: { id: item.id },
        data: { returnedQuantity: { increment: request.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          variantId: item.variantId,
          type: StockMovementType.return,
          delta: request.quantity,
          reason: AdjustmentReason.other,
          orderId,
          adminId,
          note,
        },
      });
      let left = request.quantity;
      for (const allocation of item.lotAllocations) {
        if (left <= 0) break;
        if (allocation.lot.bestByDate.getTime() <= Date.now()) continue;
        const give = Math.min(left, allocation.quantity);
        await tx.foodLot.update({ where: { id: allocation.lotId }, data: { quantity: { increment: give } } });
        left -= give;
      }
    }
    const refreshed = await tx.orderItem.findMany({ where: { orderId } });
    if (refreshed.every((item) => item.returnedQuantity >= item.quantity)) {
      await tx.order.update({ where: { id: orderId }, data: { stockReturned: true } });
    }
  }

  async expireDueLots(now = new Date()): Promise<{ expired: number; expiring: Array<{ lotCode: string; productName: string; bestByDate: Date; quantity: number }> }> {
    const horizon = new Date(now.getTime() + 14 * 86400000);
    const expiringRows = await this.prisma.foodLot.findMany({
      where: { expiredAt: null, quantity: { gt: 0 }, bestByDate: { gt: now, lte: horizon } },
      include: { product: { select: { name: true } } },
    });
    const due = await this.prisma.foodLot.findMany({
      where: { expiredAt: null, quantity: { gt: 0 }, bestByDate: { lte: now } },
    });
    let expired = 0;
    for (const lot of due) {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.foodLot.findUnique({ where: { id: lot.id } });
        if (!current || current.expiredAt || current.quantity <= 0) return;
        await this.lockStock(tx, current.productId ?? '', current.variantId);
        const available = await this.readAvailable(tx, current.productId ?? '', current.variantId);
        const remove = Math.min(current.quantity, available);
        if (remove > 0) {
          await this.addAvailable(tx, current.productId ?? '', current.variantId, -remove, {});
          await tx.stockMovement.create({
            data: {
              productId: current.productId,
              variantId: current.variantId,
              type: StockMovementType.adjustment,
              delta: -remove,
              reason: AdjustmentReason.expired,
              note: `Lot ${current.lotCode} passed its best-by date`,
            },
          });
        }
        await tx.foodLot.update({ where: { id: current.id }, data: { quantity: 0, expiredAt: now } });
        expired += 1;
      });
    }
    return {
      expired,
      expiring: expiringRows.map((lot) => ({
        lotCode: lot.lotCode,
        productName: lot.product?.name ?? 'Product',
        bestByDate: lot.bestByDate,
        quantity: lot.quantity,
      })),
    };
  }

  private async lockStock(tx: Tx, productId: string, variantId: string | null): Promise<void> {
    if (variantId) {
      await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
      return;
    }
    await tx.$queryRaw`SELECT id FROM "Inventory" WHERE "productId" = ${productId} FOR UPDATE`;
  }

  private async readAvailable(tx: Tx, productId: string, variantId: string | null): Promise<number> {
    if (variantId) {
      const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
      if (!variant) throw Errors.notFound('Variant not found');
      return variant.quantityAvailable;
    }
    const inventory = await tx.inventory.findUnique({ where: { productId } });
    if (!inventory) throw Errors.conflict('This product tracks stock on its pack sizes');
    return inventory.quantityAvailable;
  }

  private async addAvailable(
    tx: Tx,
    productId: string,
    variantId: string | null,
    delta: number,
    flags: { reserve?: number; restock?: boolean; count?: boolean },
  ): Promise<void> {
    const data = {
      quantityAvailable: { increment: delta },
      quantityReserved: flags.reserve ? { increment: flags.reserve } : undefined,
      lastRestockAt: flags.restock ? new Date() : undefined,
      lastCountAt: flags.count ? new Date() : undefined,
    };
    if (variantId) await tx.productVariant.update({ where: { id: variantId }, data });
    else await tx.inventory.update({ where: { productId }, data });
  }
}
