export interface StockCounts {
  quantityAvailable: number;
  quantityReserved: number;
  lowStockThreshold: number;
  reorderPoint: number;
}

export interface DerivedStock {
  onHand: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  needsReorder: boolean;
}

export function deriveStock(row: StockCounts): DerivedStock {
  const onHand = row.quantityAvailable + row.quantityReserved;
  return {
    onHand,
    isLowStock: row.quantityAvailable > 0 && row.quantityAvailable <= row.lowStockThreshold,
    isOutOfStock: row.quantityAvailable <= 0,
    needsReorder: row.quantityAvailable <= row.reorderPoint,
  };
}
