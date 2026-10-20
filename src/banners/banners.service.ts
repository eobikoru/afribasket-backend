import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';

const blankToUndefined = (value: unknown) => (value === '' || value === undefined ? undefined : value);

export const bannerFormSchema = z.object({
  title: z.string().trim().min(1).max(160),
  subtitle: z.preprocess(blankToUndefined, z.string().trim().max(240).optional()),
  linkUrl: z.preprocess(blankToUndefined, z.string().url().optional()),
  sortOrder: z.coerce.number().int().default(0),
  active: z.preprocess((value) => {
    if (value === undefined || value === '') return true;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  }, z.boolean()),
  startsAt: z.preprocess(blankToUndefined, z.coerce.date().nullable().optional()),
  endsAt: z.preprocess(blankToUndefined, z.coerce.date().nullable().optional()),
});

export const bannerUpdateFormSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  subtitle: z.preprocess(blankToUndefined, z.string().trim().max(240).nullable().optional()),
  linkUrl: z.preprocess(blankToUndefined, z.string().url().nullable().optional()),
  sortOrder: z.preprocess(blankToUndefined, z.coerce.number().int().optional()),
  active: z.preprocess((value) => {
    if (value === undefined || value === '') return undefined;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  }, z.boolean().optional()),
  startsAt: z.preprocess(blankToUndefined, z.coerce.date().nullable().optional()),
  endsAt: z.preprocess(blankToUndefined, z.coerce.date().nullable().optional()),
});

export const bannerSchema = bannerFormSchema.extend({
  imageUrl: z.string().url(),
  imagePublicId: z.string().optional(),
});

@Injectable()
export class BannersService {
  constructor(private readonly prisma: PrismaService) {}

  async active(now = new Date()) {
    const rows = await this.prisma.banner.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
    return rows.filter((banner) => (!banner.startsAt || banner.startsAt <= now) && (!banner.endsAt || banner.endsAt >= now));
  }

  list() {
    return this.prisma.banner.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
  }

  async get(id: string) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw Errors.notFound('Banner not found');
    return banner;
  }

  create(input: z.infer<typeof bannerSchema>) {
    return this.prisma.banner.create({ data: input });
  }

  async update(id: string, input: Prisma.BannerUpdateInput) {
    try {
      return await this.prisma.banner.update({ where: { id }, data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw Errors.notFound('Banner not found');
      throw error;
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Banner not found');
    await this.prisma.banner.delete({ where: { id } });
    return existing;
  }
}
