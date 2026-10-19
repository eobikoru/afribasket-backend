import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { Errors } from '../errors/app.exception';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown) {
    const parsed = this.schema.safeParse(value ?? {});
    if (!parsed.success) {
      throw Errors.validation(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      );
    }
    return parsed.data;
  }
}
