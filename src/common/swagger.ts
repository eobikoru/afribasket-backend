import { applyDecorators, Type } from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiQuery, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function zodToOpenApi(schema: ZodTypeAny): SchemaObject {
  return zodToJsonSchema(schema, { target: 'openApi3' }) as SchemaObject;
}

export function ApiZodBody(schema: ZodTypeAny) {
  return ApiBody({ schema: zodToOpenApi(schema) });
}

export function ApiFilterQuery(
  fields: Array<{
    name: string;
    description: string;
    type?: 'string' | 'number' | 'boolean';
    required?: boolean;
    enum?: string[];
  }>,
) {
  return applyDecorators(
    ...fields.map((field) =>
      ApiQuery({
        name: field.name,
        required: field.required ?? false,
        description: field.description,
        schema: {
          type: field.type ?? 'string',
          ...(field.enum ? { enum: field.enum } : {}),
        },
      }),
    ),
  );
}

export const PAGE_QUERIES = [
  { name: 'page', description: 'Page number, starting at 1', type: 'number' as const },
  { name: 'perPage', description: 'Page size, max 100', type: 'number' as const },
];

export function ApiErrorSchema() {
  return {
    type: 'object',
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message', 'details'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: { nullable: true },
        },
      },
    },
  };
}

export function ApiPageOf(model: Type<unknown>) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: 200,
      schema: {
        type: 'object',
        required: ['items', 'page', 'perPage', 'total'],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(model) } },
          page: { type: 'number' },
          perPage: { type: 'number' },
          total: { type: 'number' },
        },
      },
    }),
  );
}
