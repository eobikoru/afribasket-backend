import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../common/errors/app.exception';
import { rethrowUnique } from '../common/prisma-errors';
import { slugify } from '../common/slug';
import { PrismaService } from '../prisma/prisma.service';
import type { z } from 'zod';
import type { categorySchema, tagSchema } from './catalog.schemas';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async tree(activeOnly = true) {
    const rows = await this.prisma.category.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return buildTree(rows);
  }

  async create(input: z.infer<typeof categorySchema>) {
    const parent = input.parentId ? await this.require(input.parentId) : null;
    const level = parent ? parent.level + 1 : 0;
    if (level > 2) throw Errors.badRequest('Categories can be nested three levels deep');
    try {
      return await this.prisma.category.create({
        data: { ...input, parentId: input.parentId ?? null, slug: input.slug ?? slugify(input.name), level },
      });
    } catch (error) {
      rethrowUnique(error, { slug: 'A category with this slug already exists' });
    }
  }

  async update(id: string, input: Partial<z.infer<typeof categorySchema>>) {
    const existing = await this.require(id);
    let level = existing.level;
    if (input.parentId !== undefined) {
      if (input.parentId === id) throw Errors.badRequest('A category cannot be its own parent');
      const parent = input.parentId ? await this.require(input.parentId) : null;
      level = parent ? parent.level + 1 : 0;
      if (level > 2) throw Errors.badRequest('Categories can be nested three levels deep');
    }
    try {
      return await this.prisma.category.update({
        where: { id },
        data: {
          ...input,
          slug: input.slug,
          level,
          parentId: input.parentId === undefined ? undefined : input.parentId,
        },
      });
    } catch (error) {
      rethrowUnique(error, { slug: 'A category with this slug already exists' });
    }
  }

  async remove(id: string) {
    const products = await this.prisma.product.count({ where: { categoryId: id } });
    const children = await this.prisma.category.count({ where: { parentId: id } });
    if (products || children) throw Errors.conflict('Remove child categories and products first');
    await this.require(id);
    await this.prisma.category.delete({ where: { id } });
    return { ok: true };
  }

  private async require(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw Errors.notFound('Category not found');
    return category;
  }
}

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tag.findMany({ orderBy: { name: 'asc' } });
  }

  async create(input: z.infer<typeof tagSchema>) {
    try {
      return await this.prisma.tag.create({ data: { name: input.name, slug: input.slug ?? slugify(input.name) } });
    } catch (error) {
      rethrowUnique(error, { slug: 'A tag with this slug already exists' });
    }
  }

  async update(id: string, input: Partial<z.infer<typeof tagSchema>>) {
    try {
      return await this.prisma.tag.update({ where: { id }, data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw Errors.notFound('Tag not found');
      }
      rethrowUnique(error, { slug: 'A tag with this slug already exists' });
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.tag.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw Errors.notFound('Tag not found');
      }
      throw error;
    }
    return { ok: true };
  }
}

function buildTree<T extends { id: string; parentId: string | null; sortOrder: number; name: string }>(rows: T[]) {
  const nodes = new Map(rows.map((row) => [row.id, { ...row, children: [] as Array<T & { children: unknown[] }> }]));
  const roots: Array<T & { children: unknown[] }> = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId)?.children.push(node);
    else roots.push(node);
  }
  const sort = (list: Array<{ sortOrder: number; name: string; children: Array<{ sortOrder: number; name: string; children: never[] }> }>) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const node of list) sort(node.children as typeof list);
  };
  sort(roots as Array<{ sortOrder: number; name: string; children: Array<{ sortOrder: number; name: string; children: never[] }> }>);
  return roots;
}
