import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Errors } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';

export const bannerSchema = z.object({
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(240).optional(),
  imageUrl: z.string().url(),
  imagePublicId: z.string().optional(),
  linkUrl: z.string().url().optional(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
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

  create(input: z.infer<typeof bannerSchema>) {
    return this.prisma.banner.create({ data: input });
  }

  async update(id: string, input: Partial<z.infer<typeof bannerSchema>>) {
    try {
      return await this.prisma.banner.update({ where: { id }, data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw Errors.notFound('Banner not found');
      throw error;
    }
  }

  async remove(id: string) {
    await this.update(id, {});
    await this.prisma.banner.delete({ where: { id } });
    return { ok: true };
  }
}
