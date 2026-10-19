import { Prisma } from '@prisma/client';
import { Errors } from './errors/app.exception';

export function rethrowUnique(error: unknown, messages: Record<string, string>): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target ?? '');
    for (const [field, message] of Object.entries(messages)) {
      if (target.toLowerCase().includes(field.toLowerCase())) {
        throw Errors.conflict(message, { fields: error.meta?.target ?? null });
      }
    }
    throw Errors.conflict('A record with this value already exists', { fields: error.meta?.target ?? null });
  }
  throw error;
}

export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
