export interface LotSlice {
  id: string;
  quantity: number;
  bestByDate: Date;
}

export interface LotAllocation {
  lotId: string;
  take: number;
}

export class InsufficientLotQuantityError extends Error {
  readonly shortfall: number;

  constructor(shortfall: number) {
    super('Not enough unexpired lot quantity');
    this.shortfall = shortfall;
  }
}

/** First-expired, first-out. Lots are not mutated; the caller applies the takes. */
export function allocateFefo(lots: LotSlice[], quantity: number, now = new Date()): LotAllocation[] {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Lot quantity must be a positive integer');
  }
  const eligible = lots
    .filter((lot) => lot.quantity > 0 && lot.bestByDate.getTime() > now.getTime())
    .sort((a, b) => a.bestByDate.getTime() - b.bestByDate.getTime() || a.id.localeCompare(b.id));
  let remaining = quantity;
  const allocations: LotAllocation[] = [];
  for (const lot of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(lot.quantity, remaining);
    allocations.push({ lotId: lot.id, take });
    remaining -= take;
  }
  if (remaining > 0) throw new InsufficientLotQuantityError(remaining);
  return allocations;
}
