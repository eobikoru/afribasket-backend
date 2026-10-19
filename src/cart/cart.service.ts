import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { resolveLines, type RequestedLine, type ResolvedLine } from '../catalog/resolve-lines';

const GUEST_TTL_SECONDS = 60 * 60 * 24 * 30;

interface StoredItem {
  productId: string;
  variantId: string | null;
  quantity: number;
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getGuest(token: string) {
    const items = await this.readGuest(token);
    return this.present(items);
  }

  async getCustomer(customerId: string) {
    const cart = await this.ensureCustomerCart(customerId);
    return this.present(cart.items.map(toStored));
  }

  async addGuest(token: string, line: RequestedLine) {
    const items = await this.readGuest(token);
    const next = await this.mergeLine(items, line);
    await this.writeGuest(token, next);
    return this.present(next);
  }

  async addCustomer(customerId: string, line: RequestedLine) {
    const cart = await this.ensureCustomerCart(customerId);
    const items = cart.items.map(toStored);
    const next = await this.mergeLine(items, line);
    await this.replaceCustomerItems(cart.id, next);
    return this.present(next);
  }

  async updateGuest(token: string, productId: string, variantId: string | null, quantity: number) {
    const items = await this.readGuest(token);
    const next = await this.replaceQuantity(items, productId, variantId, quantity);
    await this.writeGuest(token, next);
    return this.present(next);
  }

  async updateCustomer(customerId: string, productId: string, variantId: string | null, quantity: number) {
    const cart = await this.ensureCustomerCart(customerId);
    const next = await this.replaceQuantity(cart.items.map(toStored), productId, variantId, quantity);
    await this.replaceCustomerItems(cart.id, next);
    return this.present(next);
  }

  async removeGuest(token: string, productId: string, variantId: string | null) {
    const next = (await this.readGuest(token)).filter((item) => !sameLine(item, productId, variantId));
    await this.writeGuest(token, next);
    return this.present(next);
  }

  async removeCustomer(customerId: string, productId: string, variantId: string | null) {
    const cart = await this.ensureCustomerCart(customerId);
    const next = cart.items.map(toStored).filter((item) => !sameLine(item, productId, variantId));
    await this.replaceCustomerItems(cart.id, next);
    return this.present(next);
  }

  async clearGuest(token: string) {
    await this.redis.del(this.key(token));
    return this.present([]);
  }

  async clearCustomer(customerId: string) {
    const cart = await this.ensureCustomerCart(customerId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.present([]);
  }

  async mergeGuestIntoCustomer(customerId: string, token: string | undefined): Promise<void> {
    if (!token) return;
    const guestItems = await this.readGuest(token);
    if (guestItems.length === 0) return;
    const cart = await this.ensureCustomerCart(customerId);
    let items = cart.items.map(toStored);
    for (const guest of guestItems) {
      try {
        items = await this.mergeLine(items, guest);
      } catch {
        const existing = items.find((item) => sameLine(item, guest.productId, guest.variantId));
        if (!existing) items.push(guest);
      }
    }
    await this.replaceCustomerItems(cart.id, items);
    await this.redis.del(this.key(token));
  }

  async linesForCustomer(customerId: string): Promise<RequestedLine[]> {
    const cart = await this.ensureCustomerCart(customerId);
    return cart.items.map(toStored);
  }

  async linesForGuest(token: string): Promise<RequestedLine[]> {
    return this.readGuest(token);
  }

  private async present(items: StoredItem[]) {
    const lines = items.length === 0 ? [] : await resolveLines(this.prisma, items);
    const subtotalCents = lines.reduce((sum, line) => sum + (line.purchasable ? line.lineTotalCents : 0), 0);
    return { items: lines, subtotalCents, currency: 'USD' as const };
  }

  private async mergeLine(items: StoredItem[], line: RequestedLine): Promise<StoredItem[]> {
    this.assertLine(line);
    const variantId = line.variantId ?? null;
    const existing = items.find((item) => sameLine(item, line.productId, variantId));
    const quantity = (existing?.quantity ?? 0) + line.quantity;
    await this.assertStock({ ...line, variantId, quantity });
    if (existing) existing.quantity = quantity;
    else items.push({ productId: line.productId, variantId, quantity });
    return items;
  }

  private async replaceQuantity(items: StoredItem[], productId: string, variantId: string | null, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 1) throw Errors.badRequest('Quantity must be at least 1');
    const existing = items.find((item) => sameLine(item, productId, variantId));
    if (!existing) throw Errors.notFound('Cart line not found');
    await this.assertStock({ productId, variantId, quantity });
    existing.quantity = quantity;
    return items;
  }

  private async assertStock(line: RequestedLine): Promise<ResolvedLine> {
    const [resolved] = await resolveLines(this.prisma, [line]);
    if (!resolved || !resolved.purchasable) {
      throw Errors.conflict(resolved?.unavailableReason ?? 'That item is not available');
    }
    return resolved;
  }

  private assertLine(line: RequestedLine): void {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) {
      throw Errors.badRequest('Quantity must be between 1 and 100');
    }
  }

  private async ensureCustomerCart(customerId: string) {
    return this.prisma.cart.upsert({
      where: { customerId },
      create: { customerId },
      update: {},
      include: { items: true },
    });
  }

  private async replaceCustomerItems(cartId: string, items: StoredItem[]) {
    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { cartId } });
      if (items.length === 0) return;
      await tx.cartItem.createMany({
        data: items.map((item) => ({
          cartId,
          productId: item.productId,
          variantId: item.variantId,
          variantKey: item.variantId ?? '',
          quantity: item.quantity,
        })),
      });
    });
  }

  private async readGuest(token: string): Promise<StoredItem[]> {
    const raw = await this.redis.get(this.key(token));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: StoredItem[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  }

  private async writeGuest(token: string, items: StoredItem[]): Promise<void> {
    await this.redis.set(this.key(token), JSON.stringify({ items }), GUEST_TTL_SECONDS);
  }

  private key(token: string): string {
    return `cart:guest:${token}`;
  }
}

function toStored(item: { productId: string; variantId: string | null; quantity: number }): StoredItem {
  return { productId: item.productId, variantId: item.variantId, quantity: item.quantity };
}

function sameLine(item: StoredItem, productId: string, variantId: string | null): boolean {
  return item.productId === productId && (item.variantId ?? null) === (variantId ?? null);
}
