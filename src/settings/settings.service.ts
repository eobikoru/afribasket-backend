import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppConfig } from '../config/configuration';
import { asJson } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import type { ShippingSettings } from '../shipping/shipping.types';

const methodSchema = z.object({
  baseCents: z.number().int().nonnegative(),
  perPoundCents: z.number().int().nonnegative(),
});

const zoneSchema = z.object({
  standard: methodSchema,
  expedited: methodSchema,
  overnight: methodSchema.nullable(),
});

export const shippingRatesSchema = z.object({
  contiguous: zoneSchema,
  ak_hi: zoneSchema,
  territories: zoneSchema,
});

const socialSchema = z.object({
  instagram: z.string().url().optional(),
  facebook: z.string().url().optional(),
  tiktok: z.string().url().optional(),
  youtube: z.string().url().optional(),
});

export const settingsUpdateSchema = z.object({
  storeName: z.string().trim().min(1).max(120).optional(),
  supportEmail: z.string().email().optional(),
  supportPhone: z.string().trim().min(7).max(32).optional(),
  freeShippingThresholdCents: z.number().int().nonnegative().optional(),
  coldPackSurchargeCents: z.number().int().nonnegative().optional(),
  announcementBar: z.string().max(240).nullable().optional(),
  socialLinks: socialSchema.optional(),
  defaultMetaTitle: z.string().max(160).nullable().optional(),
  defaultMetaDescription: z.string().max(320).nullable().optional(),
  shippingRates: shippingRatesSchema.optional(),
  taxFlatRateBps: z.number().int().min(0).max(10000).optional(),
});

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async get() {
    const existing = await this.prisma.siteSetting.findUnique({ where: { id: 'default' } });
    if (existing) return existing;
    const shipping = this.config.get('shipping', { infer: true });
    return this.prisma.siteSetting.create({
      data: {
        id: 'default',
        storeName: 'AfriBasket',
        supportEmail: this.config.get('email', { infer: true }).adminAlert,
        supportPhone: '+12025550100',
        freeShippingThresholdCents: shipping.freeShippingThresholdCents,
        coldPackSurchargeCents: shipping.coldPackSurchargeCents,
        socialLinks: {},
        defaultMetaTitle: 'AfriBasket',
        defaultMetaDescription: 'African groceries delivered across the United States.',
        shippingRates: asJson(shipping.zones),
        taxFlatRateBps: this.config.get('taxFlatRateBps', { infer: true }),
      },
    });
  }

  async update(input: z.infer<typeof settingsUpdateSchema>) {
    await this.get();
    return this.prisma.siteSetting.update({
      where: { id: 'default' },
      data: {
        ...input,
        socialLinks: input.socialLinks ? asJson(input.socialLinks) : undefined,
        shippingRates: input.shippingRates ? asJson(input.shippingRates) : undefined,
      },
    });
  }

  async shippingSettings(): Promise<ShippingSettings> {
    const row = await this.get();
    const fallback = this.config.get('shipping', { infer: true });
    const parsed = shippingRatesSchema.safeParse(row.shippingRates);
    return {
      freeShippingThresholdCents: row.freeShippingThresholdCents,
      coldPackSurchargeCents: row.coldPackSurchargeCents,
      zones: parsed.success ? parsed.data : fallback.zones,
    };
  }

  async publicView() {
    const row = await this.get();
    return {
      storeName: row.storeName,
      supportEmail: row.supportEmail,
      supportPhone: row.supportPhone,
      freeShippingThresholdCents: row.freeShippingThresholdCents,
      coldPackSurchargeCents: row.coldPackSurchargeCents,
      announcementBar: row.announcementBar,
      socialLinks: row.socialLinks,
      defaultMetaTitle: row.defaultMetaTitle,
      defaultMetaDescription: row.defaultMetaDescription,
      currency: 'USD' as const,
    };
  }
}
