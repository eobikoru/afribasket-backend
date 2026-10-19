import { z } from 'zod';
import { ShippingCarrier, ShippingMethod, SubstitutionPreference } from '@prisma/client';
import { usAddressSchema, usPhoneSchema } from '../common/address';
import { paginationSchema } from '../common/pagination';

const lineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(),
  quantity: z.number().int().min(1).max(100),
});

export const breakdownSchema = z.object({
  lines: z.array(lineSchema).optional(),
  useCart: z.boolean().optional(),
  shippingAddress: usAddressSchema,
  shippingMethod: z.nativeEnum(ShippingMethod),
  couponCode: z.string().trim().max(40).optional(),
  email: z.string().email().optional(),
});

export const guestCheckoutSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: usPhoneSchema,
  shippingAddress: usAddressSchema,
  billingAddress: usAddressSchema.optional(),
  billingSameAsShipping: z.boolean().default(true),
  shippingMethod: z.nativeEnum(ShippingMethod),
  couponCode: z.string().trim().max(40).optional(),
  paymentProvider: z.enum(['stripe', 'paypal']),
  deliveryNote: z.string().trim().max(500).optional(),
  substitutionPreference: z.nativeEnum(SubstitutionPreference).optional(),
  lines: z.array(lineSchema).optional(),
  useCart: z.boolean().optional(),
});

export const authCheckoutSchema = guestCheckoutSchema.omit({ email: true, firstName: true, lastName: true }).extend({
  addressId: z.string().optional(),
  shippingAddress: usAddressSchema.optional(),
  phone: usPhoneSchema.optional(),
});

export const verifySchema = z.object({
  orderNumber: z.string().trim().min(4),
  providerReference: z.string().trim().optional(),
});

export const trackSchema = z.object({
  orderNumber: z.string().trim().min(4),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().optional(),
}).refine((value) => value.email || value.phone, { message: 'Provide the order email or phone' });

export const statusSchema = z.object({
  status: z.enum(['cancelled', 'shipped', 'delivered']),
});

export const trackingSchema = z.object({
  carrier: z.nativeEnum(ShippingCarrier),
  trackingNumber: z.string().trim().min(4).max(64),
});

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  isInternal: z.boolean().default(true),
});

export const refundSchema = z.object({
  amountCents: z.number().int().positive().optional(),
});

export const returnStockSchema = z.object({
  items: z.array(z.object({ orderItemId: z.string(), quantity: z.number().int().positive() })).min(1),
});

export const adminOrderQuery = paginationSchema.extend({
  status: z.string().optional(),
  paymentStatus: z.string().optional(),
  provider: z.enum(['stripe', 'paypal']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'total_desc', 'total_asc']).default('newest'),
});
