import { Injectable } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { Errors } from '../common/errors/app.exception';
import { rethrowUnique } from '../common/prisma-errors';
import { slugify } from '../common/slug';
import { toOz } from '../common/weight';
import { PrismaService } from '../prisma/prisma.service';
import { findAgeRestriction } from './age-restriction';
import { deriveStock } from '../inventory/stock-status';
import type { z } from 'zod';
import type { productListSchema, productSchema, productUpdateSchema, variantSchema } from './catalog.schemas';

const include = {
  images: { orderBy: { sortOrder: 'asc' as const } },
  variants: { orderBy: { createdAt: 'asc' as const } },
  tags: { include: { tag: true } },
  inventory: true,
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

type ProductRecord = Prisma.ProductGetPayload<{ include: typeof include }>;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(query: z.infer<typeof productListSchema>) {
    return this.list(query, false);
  }

  async listAdmin(query: z.infer<typeof productListSchema>) {
    return this.list(query, true);
  }

  async featured() {
    const rows = await this.prisma.product.findMany({
      where: { isFeatured: true, isActive: true, status: ProductStatus.available },
      include,
      orderBy: { updatedAt: 'desc' },
      take: 12,
    });
    return this.withRatings(rows, false);
  }

  async getBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({ where: { slug, isActive: true }, include });
    if (!product || product.status === 'discontinued') throw Errors.notFound('Product not found');
    const [mapped] = await this.withRatings([product], false);
    return mapped;
  }

  async getById(id: string, admin = false) {
    const product = await this.prisma.product.findUnique({ where: { id }, include });
    if (!product || (!admin && (!product.isActive || product.status === 'discontinued'))) {
      throw Errors.notFound('Product not found');
    }
    const [mapped] = await this.withRatings([product], admin);
    return mapped;
  }

  async related(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { tags: true },
    });
    if (!product) throw Errors.notFound('Product not found');
    const tagIds = product.tags.map((tag) => tag.tagId);
    const rows = await this.prisma.product.findMany({
      where: {
        id: { not: id },
        isActive: true,
        status: ProductStatus.available,
        OR: [
          { categoryId: product.categoryId },
          ...(tagIds.length ? [{ tags: { some: { tagId: { in: tagIds } } } }] : []),
        ],
      },
      include,
      take: 8,
      orderBy: { createdAt: 'desc' },
    });
    return this.withRatings(rows, false);
  }

  async create(input: z.infer<typeof productSchema>) {
    this.assertSellable(input);
    const slug = input.slug ?? slugify(input.name);
    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            ...(this.productData(input, slug) as Prisma.ProductCreateInput),
            tags: { create: input.tagIds.map((tagId) => ({ tagId })) },
            variants: input.variants?.length
              ? { create: input.variants.map((variant) => this.variantData(variant)) }
              : undefined,
            inventory: input.variants?.length ? undefined : { create: {} },
          },
          include,
        });
        return created;
      });
      const [mapped] = await this.withRatings([product], true);
      return mapped;
    } catch (error) {
      rethrowUnique(error, { slug: 'A product with this slug already exists', sku: 'A product with this SKU already exists' });
    }
  }

  async update(id: string, input: z.infer<typeof productUpdateSchema>) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Product not found');
    this.assertSellable({ ...existing, ...input, attributes: input.attributes ?? existing.attributes });
    if (input.perishable && !(input.shelfLifeDays ?? existing.shelfLifeDays)) {
      throw Errors.badRequest('Perishable products need a shelf life');
    }
    try {
      const product = await this.prisma.product.update({
        where: { id },
        data: {
          ...this.productData({ ...input, shippingWeightOz: input.shippingWeightOz ?? toOz(existing.shippingWeightOz) }, input.slug ?? existing.slug),
          tags: input.tagIds ? { deleteMany: {}, create: input.tagIds.map((tagId) => ({ tagId })) } : undefined,
        },
        include,
      });
      const [mapped] = await this.withRatings([product], true);
      return mapped;
    } catch (error) {
      rethrowUnique(error, { slug: 'A product with this slug already exists', sku: 'A product with this SKU already exists' });
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Product not found');
    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  async addVariant(productId: string, input: z.infer<typeof variantSchema>) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, include: { inventory: true, variants: true } });
    if (!product) throw Errors.notFound('Product not found');
    if (product.inventory && (product.inventory.quantityAvailable > 0 || product.inventory.quantityReserved > 0)) {
      throw Errors.conflict('Move product stock to zero before adding pack sizes');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (product.inventory) await tx.inventory.delete({ where: { id: product.inventory.id } });
        return tx.productVariant.create({ data: { productId, ...this.variantData(input) } });
      });
    } catch (error) {
      rethrowUnique(error, { sku: 'A variant with this SKU already exists' });
    }
  }

  async updateVariant(productId: string, variantId: string, input: Partial<z.infer<typeof variantSchema>>) {
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId } });
    if (!variant) throw Errors.notFound('Variant not found');
    if (input.options) {
      const keys = Object.keys(input.options).map((key) => key.toLowerCase());
      if (keys.includes('color') || keys.includes('colour')) throw Errors.badRequest('Variants cannot use color');
    }
    try {
      return await this.prisma.productVariant.update({
        where: { id: variantId },
        data: {
          sku: input.sku,
          barcode: input.barcode,
          title: input.title,
          options: input.options ? (input.options as Prisma.InputJsonValue) : undefined,
          priceCents: input.priceCents,
          shippingWeightOz: input.shippingWeightOz == null ? undefined : new Prisma.Decimal(input.shippingWeightOz),
          netWeightOz: input.netWeightOz == null ? undefined : new Prisma.Decimal(input.netWeightOz),
          isActive: input.isActive,
          lowStockThreshold: input.lowStockThreshold,
          reorderPoint: input.reorderPoint,
          reorderQuantity: input.reorderQuantity,
        },
      });
    } catch (error) {
      rethrowUnique(error, { sku: 'A variant with this SKU already exists' });
    }
  }

  async removeVariant(productId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId } });
    if (!variant) throw Errors.notFound('Variant not found');
    if (variant.quantityReserved > 0) throw Errors.conflict('This pack has reserved stock');
    await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.delete({ where: { id: variantId } });
      const remaining = await tx.productVariant.count({ where: { productId } });
      if (remaining === 0) await tx.inventory.create({ data: { productId } });
    });
    return { ok: true };
  }

  async addImage(productId: string, image: { url: string; publicId: string; altText?: string }) {
    const count = await this.prisma.productImage.count({ where: { productId } });
    return this.prisma.productImage.create({
      data: { productId, ...image, isPrimary: count === 0, sortOrder: count },
    });
  }

  async reorderImages(productId: string, images: Array<{ id: string; sortOrder: number; isPrimary: boolean }>) {
    const existing = await this.prisma.productImage.findMany({ where: { productId } });
    const ids = new Set(existing.map((image) => image.id));
    if (images.some((image) => !ids.has(image.id)) || images.filter((image) => image.isPrimary).length !== 1) {
      throw Errors.badRequest('Provide every image and exactly one primary image');
    }
    await this.prisma.$transaction(
      images.map((image) =>
        this.prisma.productImage.update({
          where: { id: image.id },
          data: { sortOrder: image.sortOrder, isPrimary: image.isPrimary },
        }),
      ),
    );
    return this.prisma.productImage.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } });
  }

  async deleteImage(productId: string, imageId: string) {
    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (!image) throw Errors.notFound('Image not found');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    if (image.isPrimary) {
      const next = await this.prisma.productImage.findFirst({ where: { productId }, orderBy: { sortOrder: 'asc' } });
      if (next) await this.prisma.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return image;
  }

  private async list(query: z.infer<typeof productListSchema>, admin: boolean) {
    const where = await this.where(query, admin);
    const orderBy = {
      newest: { createdAt: 'desc' as const },
      price_asc: { priceCents: 'asc' as const },
      price_desc: { priceCents: 'desc' as const },
      name_asc: { name: 'asc' as const },
      name_desc: { name: 'desc' as const },
    }[query.sort];
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include,
        orderBy,
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);
    return {
      items: await this.withRatings(rows, admin),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  private async where(query: z.infer<typeof productListSchema>, admin: boolean): Promise<Prisma.ProductWhereInput> {
    const categoryIds = query.category ? await this.categoryIds(query.category) : undefined;
    const price: Prisma.IntFilter = {};
    if (query.minPrice != null) price.gte = query.minPrice;
    if (query.maxPrice != null) price.lte = query.maxPrice;
    const and: Prisma.ProductWhereInput[] = [];
    if (query.q) {
      and.push({
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { brand: { contains: query.q, mode: 'insensitive' } },
          { sku: { contains: query.q, mode: 'insensitive' } },
          { description: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.inStock === 'true') {
      and.push({
        status: ProductStatus.available,
        OR: [
          { variants: { none: {} }, inventory: { quantityAvailable: { gt: 0 } } },
          { variants: { some: { isActive: true, quantityAvailable: { gt: 0 } } } },
        ],
      });
    }
    return {
      ...(admin ? {} : { isActive: true, status: { not: ProductStatus.discontinued } }),
      ...(and.length ? { AND: and } : {}),
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(query.tag ? { tags: { some: { tag: { slug: query.tag } } } } : {}),
      ...(query.country ? { countryOfOrigin: query.country.toUpperCase() } : {}),
      ...(query.region ? { region: query.region } : {}),
      ...(query.storageType ? { storageType: query.storageType } : {}),
      ...(query.dietary ? { dietaryTags: { has: query.dietary } } : {}),
      ...(query.featured === 'true' ? { isFeatured: true } : {}),
      ...(Object.keys(price).length ? { priceCents: price } : {}),
    };
  }

  private async categoryIds(category: string): Promise<string[]> {
    const rows = await this.prisma.category.findMany({ select: { id: true, slug: true, parentId: true } });
    const match = rows.find((row) => row.id === category || row.slug === category);
    if (!match) return ['__none__'];
    const children = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.parentId) continue;
      const list = children.get(row.parentId) ?? [];
      list.push(row.id);
      children.set(row.parentId, list);
    }
    const ids: string[] = [];
    const walk = (id: string) => {
      ids.push(id);
      for (const child of children.get(id) ?? []) walk(child);
    };
    walk(match.id);
    return ids;
  }

  private async withRatings(products: ProductRecord[], admin: boolean) {
    const ids = products.map((product) => product.id);
    const grouped = ids.length
      ? await this.prisma.productReview.groupBy({
          by: ['productId'],
          where: { productId: { in: ids }, isHidden: false },
          _avg: { rating: true },
          _count: { _all: true },
        })
      : [];
    const ratings = new Map(grouped.map((row) => [row.productId, row]));
    return products.map((product) => this.map(product, ratings.get(product.id), admin));
  }

  private map(
    product: ProductRecord,
    rating: { _avg: { rating: number | null }; _count: { _all: number } } | undefined,
    admin: boolean,
  ) {
    const stock = product.variants.length
      ? null
      : product.inventory
        ? { ...product.inventory, ...deriveStock(product.inventory) }
        : null;
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      barcode: product.barcode,
      shortDescription: product.shortDescription,
      description: product.description,
      brand: product.brand,
      countryOfOrigin: product.countryOfOrigin,
      region: product.region,
      priceCents: product.priceCents,
      compareAtPriceCents: product.compareAtPriceCents,
      ...(admin ? { costCents: product.costCents } : {}),
      status: product.status,
      isActive: product.isActive,
      isFeatured: product.isFeatured,
      storageType: product.storageType,
      perishable: product.perishable,
      shelfLifeDays: product.shelfLifeDays,
      netWeightOz: product.netWeightOz == null ? null : toOz(product.netWeightOz),
      shippingWeightOz: toOz(product.shippingWeightOz),
      unitLabel: product.unitLabel,
      ingredients: product.ingredients,
      allergenFlags: product.allergenFlags,
      dietaryTags: product.dietaryTags,
      attributes: product.attributes,
      metaTitle: product.metaTitle,
      metaDescription: product.metaDescription,
      category: product.category,
      tags: product.tags.map((row) => ({ id: row.tag.id, name: row.tag.name, slug: row.tag.slug })),
      images: product.images,
      variants: product.variants.map((variant) => ({
        ...variant,
        shippingWeightOz: variant.shippingWeightOz == null ? null : toOz(variant.shippingWeightOz),
        netWeightOz: variant.netWeightOz == null ? null : toOz(variant.netWeightOz),
        ...deriveStock(variant),
      })),
      inventory: stock,
      ratingAverage: rating?._count._all ? Number((rating._avg.rating ?? 0).toFixed(1)) : null,
      ratingCount: rating?._count._all ?? 0,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private assertSellable(input: { name?: string | null; description?: string | null; shortDescription?: string | null; brand?: string | null; attributes?: unknown }) {
    const hit = findAgeRestriction(input);
    if (hit) throw Errors.unprocessable(`AfriBasket does not sell age-restricted products (${hit})`);
  }

  private productData(input: Partial<z.infer<typeof productSchema>> & { shippingWeightOz?: number }, slug: string): Prisma.ProductUpdateInput {
    return {
      name: input.name,
      slug,
      sku: input.sku,
      barcode: input.barcode,
      shortDescription: input.shortDescription,
      description: input.description,
      brand: input.brand,
      countryOfOrigin: input.countryOfOrigin,
      region: input.region,
      priceCents: input.priceCents,
      compareAtPriceCents: input.compareAtPriceCents,
      costCents: input.costCents,
      status: input.status,
      isActive: input.isActive,
      isFeatured: input.isFeatured,
      storageType: input.storageType,
      perishable: input.perishable,
      shelfLifeDays: input.shelfLifeDays,
      netWeightOz: input.netWeightOz == null ? undefined : new Prisma.Decimal(input.netWeightOz),
      shippingWeightOz: input.shippingWeightOz == null ? undefined : new Prisma.Decimal(input.shippingWeightOz),
      unitLabel: input.unitLabel,
      ingredients: input.ingredients,
      allergenFlags: input.allergenFlags,
      dietaryTags: input.dietaryTags,
      attributes: input.attributes as Prisma.InputJsonValue | undefined,
      metaTitle: input.metaTitle,
      metaDescription: input.metaDescription,
      category: input.categoryId ? { connect: { id: input.categoryId } } : undefined,
    };
  }

  private variantData(input: z.infer<typeof variantSchema>): Prisma.ProductVariantCreateWithoutProductInput {
    return {
      sku: input.sku,
      barcode: input.barcode,
      options: input.options as Prisma.InputJsonValue,
      title: input.title,
      priceCents: input.priceCents,
      shippingWeightOz: input.shippingWeightOz == null ? undefined : new Prisma.Decimal(input.shippingWeightOz),
      netWeightOz: input.netWeightOz == null ? undefined : new Prisma.Decimal(input.netWeightOz),
      quantityAvailable: input.quantityAvailable,
      lowStockThreshold: input.lowStockThreshold,
      reorderPoint: input.reorderPoint,
      reorderQuantity: input.reorderQuantity,
      imageUrl: input.imageUrl,
      imagePublicId: input.imagePublicId,
      isActive: input.isActive,
    };
  }
}
