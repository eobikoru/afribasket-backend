import { Prisma, type PrismaClient, type StorageType } from '@prisma/client';
import { toOz } from '../common/weight';

export interface RequestedLine {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

export interface ResolvedLine {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  imageUrl: string | null;
  storageType: StorageType;
  shippingWeightOz: number;
  requiresLot: boolean;
  available: number;
  purchasable: boolean;
  unavailableReason: string | null;
  taxCode: string;
}

type Db = PrismaClient | Prisma.TransactionClient;

const productInclude = {
  images: { orderBy: { sortOrder: 'asc' as const } },
  variants: true,
  inventory: true,
  category: { select: { slug: true, parent: { select: { slug: true } } } },
} satisfies Prisma.ProductInclude;

export async function resolveLines(db: Db, requests: RequestedLine[]): Promise<ResolvedLine[]> {
  const ids = [...new Set(requests.map((line) => line.productId))];
  const products = await db.product.findMany({ where: { id: { in: ids } }, include: productInclude });
  const byId = new Map(products.map((product) => [product.id, product]));
  return requests.map((request) => {
    const product = byId.get(request.productId);
    if (!product) {
      return emptyLine(request, 'Product is no longer available');
    }
    const variant = request.variantId ? product.variants.find((item) => item.id === request.variantId) : undefined;
    if (product.variants.length > 0 && !request.variantId) {
      return emptyLine(request, 'Choose a size or pack', product.name);
    }
    if (request.variantId && !variant) {
      return emptyLine(request, 'That pack size is not available', product.name);
    }
    if (!product.isActive || product.status !== 'available') {
      return emptyLine(request, 'This product is not available for sale', product.name);
    }
    if (variant && !variant.isActive) {
      return emptyLine(request, 'That pack size is not available', product.name);
    }
    const available = variant ? variant.quantityAvailable : (product.inventory?.quantityAvailable ?? 0);
    const unitPriceCents = variant?.priceCents ?? product.priceCents;
    const shippingWeightOz = toOz(variant?.shippingWeightOz ?? product.shippingWeightOz);
    const imageUrl = variant?.imageUrl ?? product.images.find((image) => image.isPrimary)?.url ?? product.images[0]?.url ?? null;
    const household = product.category.slug === 'household' || product.category.parent?.slug === 'household';
    const reason =
      request.quantity < 1
        ? 'Quantity must be at least 1'
        : available < request.quantity
          ? `Only ${available} available`
          : null;
    return {
      productId: product.id,
      variantId: variant?.id ?? null,
      name: variant ? `${product.name} — ${variant.title}` : product.name,
      sku: variant?.sku ?? product.sku,
      unitPriceCents,
      quantity: request.quantity,
      lineTotalCents: unitPriceCents * request.quantity,
      imageUrl,
      storageType: product.storageType,
      shippingWeightOz: shippingWeightOz * request.quantity,
      requiresLot: product.perishable || product.storageType === 'frozen',
      available,
      purchasable: reason == null,
      unavailableReason: reason,
      taxCode: household ? 'txcd_99999999' : 'txcd_40040000',
    };
  });
}

function emptyLine(request: RequestedLine, reason: string, name = 'Unavailable item'): ResolvedLine {
  return {
    productId: request.productId,
    variantId: request.variantId ?? null,
    name,
    sku: '',
    unitPriceCents: 0,
    quantity: request.quantity,
    lineTotalCents: 0,
    imageUrl: null,
    storageType: 'ambient',
    shippingWeightOz: 0,
    requiresLot: false,
    available: 0,
    purchasable: false,
    unavailableReason: reason,
    taxCode: 'txcd_40040000',
  };
}
