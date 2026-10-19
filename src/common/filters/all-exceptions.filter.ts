import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app.exception';
import { redact } from '../logger/redact';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const resolved = this.resolve(exception);
    if (resolved.status >= 500) {
      this.logger.error(
        JSON.stringify(
          redact({
            msg: 'request_failed',
            path: request?.originalUrl,
            method: request?.method,
            requestId: request?.requestId,
            code: resolved.code,
            message: resolved.message,
          }),
        ),
      );
    }

    response.status(resolved.status).json({
      error: {
        code: resolved.code,
        message: resolved.message,
        details: resolved.details,
      },
    });
  }

  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: unknown;
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const target = exception.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : 'field';
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: `A record with this ${fields} already exists`,
          details: { fields: target ?? null },
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Record not found',
          details: null,
        };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let message = exception.message;
      let details: unknown = null;
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (typeof record.message === 'string') message = record.message;
        else if (Array.isArray(record.message)) {
          message = 'Validation failed';
          details = record.message;
        }
        if ('details' in record) details = record.details;
        if (typeof record.code === 'string' && record.code.length > 0) {
          return {
            status,
            code: record.code,
            message,
            details,
          };
        }
      }
      return {
        status,
        code: STATUS_CODES[status] ?? 'HTTP_ERROR',
        message,
        details,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
      details: null,
    };
  }
}
