import { Injectable } from '@nestjs/common';
import { BlogPostStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { Errors } from '../common/errors/app.exception';
import { rethrowUnique } from '../common/prisma-errors';
import { slugify } from '../common/slug';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { sanitizeBlogHtml } from './sanitize';

const VIEWS_KEY = 'blog:views';

export const blogCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().max(500).optional(),
});

export const blogPostSchema = z.object({
  title: z.string().trim().min(1).max(180),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  excerpt: z.string().trim().min(1).max(500),
  bodyHtml: z.string().min(1),
  coverImageUrl: z.string().url().optional(),
  coverImagePublicId: z.string().optional(),
  status: z.nativeEnum(BlogPostStatus).default(BlogPostStatus.draft),
  metaTitle: z.string().max(160).optional(),
  metaDescription: z.string().max(320).optional(),
  categoryId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).default([]),
  authorId: z.string().optional(),
  faqs: z.array(z.object({ question: z.string().min(1).max(240), answer: z.string().min(1).max(2000), sortOrder: z.number().int().default(0) })).default([]),
});

export const commentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  body: z.string().trim().min(1).max(2000),
});

@Injectable()
export class BlogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async listPublic(query: { page: number; perPage: number; category?: string; tag?: string }) {
    const where: Prisma.BlogPostWhereInput = {
      status: BlogPostStatus.published,
      publishedAt: { lte: new Date() },
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.tag ? { tags: { some: { tag: { slug: query.tag } } } } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.blogPost.count({ where }),
      this.prisma.blogPost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: this.cardInclude(),
      }),
    ]);
    return { items: items.map(toCard), page: query.page, perPage: query.perPage, total };
  }

  async relatedBySlug(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, status: BlogPostStatus.published, publishedAt: { lte: new Date() } },
      include: { tags: true },
    });
    if (!post) throw Errors.notFound('Post not found');
    return this.related(post.id, post.categoryId, post.tags.map((tag) => tag.tagId));
  }

  async getBySlug(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, status: BlogPostStatus.published, publishedAt: { lte: new Date() } },
      include: { ...this.cardInclude(), faqs: { orderBy: { sortOrder: 'asc' } }, comments: { where: { isHidden: false }, orderBy: { createdAt: 'desc' } } },
    });
    if (!post) throw Errors.notFound('Post not found');
    await this.redis.hincrby(VIEWS_KEY, post.id, 1).catch(() => 0);
    const related = await this.related(post.id, post.categoryId, post.tags.map((tag) => tag.tagId));
    return { ...toDetail(post), related };
  }

  async comment(slug: string, input: z.infer<typeof commentSchema>, ip: string, customerId?: string) {
    const post = await this.prisma.blogPost.findFirst({ where: { slug, status: 'published' } });
    if (!post) throw Errors.notFound('Post not found');
    const email = input.email.toLowerCase();
    const short = await this.redis.setNx(`blog:comment:${ip}:${email}`, '1', 60);
    if (!short) throw Errors.tooMany('Please wait a minute before commenting again');
    const emailCount = await this.redis.incr(`blog:comment:email:${email}`);
    if (emailCount === 1) await this.redis.expire(`blog:comment:email:${email}`, 3600);
    if (emailCount > 5) throw Errors.tooMany('Too many comments from this email');
    const ipCount = await this.redis.incr(`blog:comment:ip:${ip || 'unknown'}`);
    if (ipCount === 1) await this.redis.expire(`blog:comment:ip:${ip || 'unknown'}`, 3600);
    if (ipCount > 10) throw Errors.tooMany('Too many comments from this network');
    return this.prisma.blogComment.create({
      data: { postId: post.id, customerId, name: input.name, email, body: input.body, ip },
    });
  }

  async listAdmin(query: { page: number; perPage: number; status?: BlogPostStatus }) {
    const where = query.status ? { status: query.status } : {};
    const [total, items] = await this.prisma.$transaction([
      this.prisma.blogPost.count({ where }),
      this.prisma.blogPost.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.perPage, take: query.perPage, include: this.cardInclude() }),
    ]);
    return { items, page: query.page, perPage: query.perPage, total };
  }

  async createPost(authorId: string, input: z.infer<typeof blogPostSchema>) {
    try {
      return await this.prisma.blogPost.create({
        data: this.postData(authorId, input),
        include: this.cardInclude(),
      });
    } catch (error) {
      rethrowUnique(error, { slug: 'A post with this slug already exists' });
    }
  }

  async updatePost(id: string, actorId: string, input: Partial<z.infer<typeof blogPostSchema>>) {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Post not found');
    try {
      return await this.prisma.blogPost.update({
        where: { id },
        data: {
          title: input.title,
          slug: input.slug,
          excerpt: input.excerpt,
          bodyHtml: input.bodyHtml ? sanitizeBlogHtml(input.bodyHtml) : undefined,
          coverImageUrl: input.coverImageUrl,
          coverImagePublicId: input.coverImagePublicId,
          status: input.status,
          metaTitle: input.metaTitle,
          metaDescription: input.metaDescription,
          categoryId: input.categoryId === undefined ? undefined : input.categoryId,
          authorId: input.authorId ?? undefined,
          publishedAt: input.status === 'published' ? existing.publishedAt ?? new Date() : input.status === 'draft' ? null : undefined,
          tags: input.tagIds ? { deleteMany: {}, create: input.tagIds.map((tagId) => ({ tagId })) } : undefined,
          faqs: input.faqs ? { deleteMany: {}, create: input.faqs } : undefined,
        },
      });
    } catch (error) {
      rethrowUnique(error, { slug: 'A post with this slug already exists' });
    }
  }

  async removePost(id: string) {
    await this.prisma.blogPost.delete({ where: { id } });
    return { ok: true };
  }

  listCategories() {
    return this.prisma.blogCategory.findMany({ orderBy: { name: 'asc' } });
  }

  createCategory(input: z.infer<typeof blogCategorySchema>) {
    return this.prisma.blogCategory.create({ data: { ...input, slug: input.slug ?? slugify(input.name) } }).catch((error) => {
      rethrowUnique(error, { slug: 'A blog category with this slug already exists' });
    });
  }

  listTags() {
    return this.prisma.blogTag.findMany({ orderBy: { name: 'asc' } });
  }

  createTag(name: string, slug?: string) {
    return this.prisma.blogTag.create({ data: { name, slug: slug ?? slugify(name) } }).catch((error) => {
      rethrowUnique(error, { slug: 'A blog tag with this slug already exists' });
    });
  }

  async hideComment(id: string, hidden: boolean) {
    return this.prisma.blogComment.update({ where: { id }, data: { isHidden: hidden } });
  }

  async deleteComment(id: string) {
    await this.prisma.blogComment.delete({ where: { id } });
    return { ok: true };
  }

  async flushViews(): Promise<number> {
    const snapshot = `${VIEWS_KEY}:flush:${Date.now()}`;
    try {
      await this.redis.rename(VIEWS_KEY, snapshot);
    } catch {
      return 0;
    }
    const counts = await this.redis.hgetall(snapshot);
    let updated = 0;
    for (const [postId, count] of Object.entries(counts)) {
      const increment = Number(count);
      if (!Number.isInteger(increment) || increment <= 0) continue;
      await this.prisma.blogPost.updateMany({ where: { id: postId }, data: { viewCount: { increment } } });
      updated += 1;
    }
    await this.redis.del(snapshot);
    return updated;
  }

  counts() {
    return this.prisma.blogPost.groupBy({ by: ['status'], _count: { _all: true } });
  }

  private async related(postId: string, categoryId: string | null, tagIds: string[]) {
    const rows = await this.prisma.blogPost.findMany({
      where: {
        id: { not: postId },
        status: 'published',
        OR: [
          ...(categoryId ? [{ categoryId }] : []),
          ...(tagIds.length ? [{ tags: { some: { tagId: { in: tagIds } } } }] : []),
        ],
      },
      take: 4,
      orderBy: { publishedAt: 'desc' },
      include: this.cardInclude(),
    });
    return rows.map(toCard);
  }

  private postData(authorId: string, input: z.infer<typeof blogPostSchema>): Prisma.BlogPostCreateInput {
    return {
      title: input.title,
      slug: input.slug ?? slugify(input.title),
      excerpt: input.excerpt,
      bodyHtml: sanitizeBlogHtml(input.bodyHtml),
      coverImageUrl: input.coverImageUrl,
      coverImagePublicId: input.coverImagePublicId,
      status: input.status,
      metaTitle: input.metaTitle,
      metaDescription: input.metaDescription,
      publishedAt: input.status === 'published' ? new Date() : null,
      author: { connect: { id: input.authorId ?? authorId } },
      category: input.categoryId ? { connect: { id: input.categoryId } } : undefined,
      tags: { create: input.tagIds.map((tagId) => ({ tagId })) },
      faqs: { create: input.faqs },
    };
  }

  private cardInclude() {
    return {
      author: { select: { id: true, name: true } },
      category: true,
      tags: { include: { tag: true } },
    } satisfies Prisma.BlogPostInclude;
  }
}

function toCard(post: {
  title: string;
  slug: string;
  excerpt: string;
  coverImageUrl: string | null;
  status: BlogPostStatus;
  publishedAt: Date | null;
  viewCount: number;
  author: { id: string; name: string };
  category: { name: string; slug: string } | null;
  tags: Array<{ tag: { name: string; slug: string } }>;
}) {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    coverImageUrl: post.coverImageUrl,
    status: post.status,
    publishedAt: post.publishedAt,
    viewCount: post.viewCount,
    author: post.author,
    category: post.category,
    tags: post.tags.map((row) => row.tag),
  };
}

function toDetail(post: Parameters<typeof toCard>[0] & { bodyHtml: string; metaTitle: string | null; metaDescription: string | null; faqs: unknown[]; comments: unknown[] }) {
  return { ...toCard(post), bodyHtml: post.bodyHtml, metaTitle: post.metaTitle, metaDescription: post.metaDescription, faqs: post.faqs, comments: post.comments };
}
