import { StockMovementType } from '@prisma/client';
import { InventoryService } from './inventory.service';

describe('stock reservation', () => {
  function memory() {
    const inventory = { productId: 'p1', quantityAvailable: 10, quantityReserved: 0 };
    const lots = [
      { id: 'expired', quantity: 9, bestByDate: new Date('2020-01-01'), expiredAt: null },
      { id: 'soon', quantity: 3, bestByDate: new Date('2026-11-01'), expiredAt: null },
      { id: 'later', quantity: 8, bestByDate: new Date('2027-01-01'), expiredAt: null },
    ];
    const movements: Array<{ type: string; delta: number; note?: string }> = [];
    const allocations: Array<{ lotId: string; quantity: number }> = [];
    let order: {
      id: string;
      status: string;
      stockReturned: boolean;
      items: Array<{
        productId: string;
        variantId: string | null;
        quantity: number;
        lotAllocations: Array<{ lotId: string; quantity: number }>;
      }>;
    } | null = null;

    const apply = (row: { quantityAvailable: number; quantityReserved: number }, data: Record<string, { increment?: number; decrement?: number } | undefined>) => {
      if (data.quantityAvailable?.increment != null) row.quantityAvailable += data.quantityAvailable.increment;
      if (data.quantityAvailable?.decrement != null) row.quantityAvailable -= data.quantityAvailable.decrement;
      if (data.quantityReserved?.increment != null) row.quantityReserved += data.quantityReserved.increment;
      if (data.quantityReserved?.decrement != null) row.quantityReserved -= data.quantityReserved.decrement;
    };

    const tx = {
      $queryRaw: async () => [],
      inventory: {
        findUnique: async () => inventory,
        update: async ({ data }: { data: Record<string, { increment?: number; decrement?: number }> }) => {
          apply(inventory, data);
          return inventory;
        },
      },
      productVariant: {
        findUnique: async () => null,
        update: async () => {
          throw new Error('unexpected variant update');
        },
      },
      stockMovement: {
        create: async ({ data }: { data: { type: string; delta: number; note?: string } }) => {
          movements.push(data);
          return data;
        },
      },
      foodLot: {
        findMany: async () => lots.filter((lot) => lot.quantity > 0 && lot.expiredAt == null),
        update: async ({ where, data }: { where: { id: string }; data: { quantity?: { increment?: number; decrement?: number } } }) => {
          const lot = lots.find((row) => row.id === where.id);
          if (!lot) throw new Error('missing lot');
          if (data.quantity?.decrement != null) lot.quantity -= data.quantity.decrement;
          if (data.quantity?.increment != null) lot.quantity += data.quantity.increment;
          return lot;
        },
      },
      orderItemLot: {
        create: async ({ data }: { data: { lotId: string; quantity: number } }) => {
          allocations.push(data);
          return data;
        },
      },
      order: {
        findUnique: async () => order,
        update: async ({ data }: { data: { stockReturned?: boolean } }) => {
          if (order && data.stockReturned != null) order.stockReturned = data.stockReturned;
          return order;
        },
      },
    };

    return { tx, inventory, lots, movements, allocations, setOrder: (value: typeof order) => { order = value; } };
  }

  const service = new InventoryService({} as never);

  it('reserves available stock and decrements the soonest unexpired lots', async () => {
    const db = memory();
    await service.reserveLines(db.tx as never, 'ord_1', [
      { productId: 'p1', variantId: null, quantity: 5, requiresLot: true, orderItemId: 'item_1' },
    ]);
    expect(db.inventory).toMatchObject({ quantityAvailable: 5, quantityReserved: 5 });
    expect(db.lots.map((lot) => [lot.id, lot.quantity])).toEqual([
      ['expired', 9],
      ['soon', 0],
      ['later', 6],
    ]);
    expect(db.allocations).toEqual([
      { orderItemId: 'item_1', lotId: 'soon', quantity: 3 },
      { orderItemId: 'item_1', lotId: 'later', quantity: 2 },
    ]);
    expect(db.movements[0]).toMatchObject({ type: StockMovementType.reservation, delta: -5 });
  });

  it('refuses a reservation when available quantity is short and leaves stock unchanged', async () => {
    const db = memory();
    await expect(
      service.reserveLines(db.tx as never, 'ord_1', [
        { productId: 'p1', variantId: null, quantity: 11, requiresLot: false, orderItemId: 'item_1' },
      ]),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.inventory.quantityAvailable).toBe(10);
    expect(db.movements).toHaveLength(0);
  });

  it('releases a pending reservation back to available stock and the original lots', async () => {
    const db = memory();
    db.inventory.quantityAvailable = 5;
    db.inventory.quantityReserved = 5;
    db.lots.find((lot) => lot.id === 'soon')!.quantity = 0;
    db.lots.find((lot) => lot.id === 'later')!.quantity = 6;
    db.setOrder({
      id: 'ord_1',
      status: 'pending',
      stockReturned: false,
      items: [
        {
          productId: 'p1',
          variantId: null,
          quantity: 5,
          lotAllocations: [
            { lotId: 'soon', quantity: 3 },
            { lotId: 'later', quantity: 2 },
          ],
        },
      ],
    });
    const released = await service.releaseReservation(db.tx as never, 'ord_1', 'Reservation expired');
    expect(released).toBe(true);
    expect(db.inventory).toMatchObject({ quantityAvailable: 10, quantityReserved: 0 });
    expect(db.lots.find((lot) => lot.id === 'soon')?.quantity).toBe(3);
    expect(db.lots.find((lot) => lot.id === 'later')?.quantity).toBe(8);
    expect(db.movements[0]).toMatchObject({ type: StockMovementType.release, delta: 5 });
  });
});
