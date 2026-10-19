import { z } from 'zod';
import { usAddressSchema, usPhoneSchema } from '../common/address';

const emailSchema = z.string().trim().email().max(180).transform((value) => value.toLowerCase());
const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: 'Password must include a letter and a number',
  });

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: usPhoneSchema.optional(),
  marketingOptIn: z.boolean().default(false),
  cartToken: z.string().min(8).max(80).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  cartToken: z.string().min(8).max(80).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).optional(),
});

export const forgotSchema = z.object({ email: emailSchema });

export const resetSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: usPhoneSchema.nullable().optional(),
  marketingOptIn: z.boolean().optional(),
  defaultAddressId: z.string().min(1).nullable().optional(),
});

export const addressSchema = usAddressSchema.extend({
  label: z.string().trim().max(40).optional(),
});

export const adminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const createAdminSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(120),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'BLOG_AUTHOR']),
});

export const changeRoleSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'BLOG_AUTHOR']),
});
