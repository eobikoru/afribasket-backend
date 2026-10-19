import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export function pageArgs(query: { page: number; perPage: number }) {
  return {
    skip: (query.page - 1) * query.perPage,
    take: query.perPage,
  };
}

export function paginated<T>(items: T[], total: number, page: number, perPage: number) {
  return { items, page, perPage, total };
}
