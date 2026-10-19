import { z } from 'zod';
import {
  AllergenFlag,
  DietaryTag,
  ProductStatus,
  RegionTag,
  StorageType,
  UnitLabel,
} from '@prisma/client';
import { isIsoCountry } from '../common/iso-country';
import { paginationSchema } from '../common/pagination';

const money = z.number().int().nonnegative();
const weight = z.number().positive().max(100000);

export const variantOptionsSchema = z
  .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(80))
  .refine((value) => {
    const keys = Object.keys(value).map((key) => key.toLowerCase());
    return keys.length > 0 && !keys.includes('color') && !keys.includes('colour');
  }, 'Variant options must describe size or pack, not color');

export const variantSchema = z.object({
  sku: z.string().trim().min(2).max(64),
  barcode: z.string().trim().max(32).optional(),
  options: variantOptionsSchema,
  title: z.string().trim().min(1).max(120),
  priceCents: money.positive().optional(),
  shippingWeightOz: weight.optional(),
  netWeightOz: weight.optional(),
  quantityAvailable: z.number().int().nonnegative().default(0),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  reorderPoint: z.number().int().nonnegative().optional(),
  reorderQuantity: z.number().int().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
  imagePublicId: z.string().optional(),
  isActive: z.boolean().default(true),
});

const productObject = z.object({
  name: z.string().trim().min(1).max(180),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  sku: z.string().trim().min(2).max(64),
  barcode: z.string().trim().max(32).optional(),
  shortDescription: z.string().trim().max(300).optional(),
  description: z.string().trim().max(8000).optional(),
  brand: z.string().trim().max(120).optional(),
  countryOfOrigin: z.string().trim().toUpperCase().refine(isIsoCountry, 'Use an ISO country code'),
  region: z.nativeEnum(RegionTag),
  priceCents: money.positive(),
  compareAtPriceCents: money.positive().optional(),
  costCents: money.nonnegative().optional(),
  status: z.nativeEnum(ProductStatus).default(ProductStatus.available),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  storageType: z.nativeEnum(StorageType).default(StorageType.ambient),
  perishable: z.boolean().default(false),
  shelfLifeDays: z.number().int().positive().max(3650).optional(),
  netWeightOz: weight.optional(),
  shippingWeightOz: weight,
  unitLabel: z.nativeEnum(UnitLabel).default(UnitLabel.each),
  ingredients: z.string().trim().max(4000).optional(),
  allergenFlags: z.array(z.nativeEnum(AllergenFlag)).default([]),
  dietaryTags: z.array(z.nativeEnum(DietaryTag)).default([]),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  metaTitle: z.string().trim().max(160).optional(),
  metaDescription: z.string().trim().max(320).optional(),
  categoryId: z.string().min(1),
  tagIds: z.array(z.string()).default([]),
  variants: z.array(variantSchema).optional(),
});

export const productSchema = productObject.superRefine((value, ctx) => {
  if (value.perishable && !value.shelfLifeDays) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shelfLifeDays'], message: 'Perishable products need a shelf life' });
  }
  if (value.compareAtPriceCents != null && value.compareAtPriceCents < value.priceCents) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['compareAtPriceCents'], message: 'Compare-at price must be at least the price' });
  }
});

export const productUpdateSchema = productObject.partial().omit({ variants: true });

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().trim().max(1000).optional(),
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().default(0),
  imageUrl: z.string().url().optional(),
  imagePublicId: z.string().optional(),
  metaTitle: z.string().max(160).optional(),
  metaDescription: z.string().max(320).optional(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
});

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
});

export const productListSchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  country: z.string().optional(),
  region: z.nativeEnum(RegionTag).optional(),
  storageType: z.nativeEnum(StorageType).optional(),
  dietary: z.nativeEnum(DietaryTag).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  inStock: z.enum(['true', 'false']).optional(),
  featured: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'name_asc', 'name_desc']).default('newest'),
});

export const imageReorderSchema = z.object({
  images: z.array(z.object({
    id: z.string(),
    sortOrder: z.number().int(),
    isPrimary: z.boolean(),
  })).min(1),
});
