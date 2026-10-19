import { HttpStatus } from '@nestjs/common';

export interface ErrorBody {
  code: string;
  message: string;
  details: unknown;
}

export class AppException extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details: unknown = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details ?? null;
  }

  toBody(): { error: ErrorBody } {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export const Errors = {
  badRequest: (message: string, details: unknown = null) =>
    new AppException('BAD_REQUEST', message, HttpStatus.BAD_REQUEST, details),
  validation: (details: unknown) =>
    new AppException('VALIDATION_ERROR', 'Validation failed', HttpStatus.BAD_REQUEST, details),
  unauthorized: (message = 'Unauthorized') =>
    new AppException('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED),
  forbidden: (message = 'Forbidden') => new AppException('FORBIDDEN', message, HttpStatus.FORBIDDEN),
  notFound: (message: string) => new AppException('NOT_FOUND', message, HttpStatus.NOT_FOUND),
  conflict: (message: string, details: unknown = null) =>
    new AppException('CONFLICT', message, HttpStatus.CONFLICT, details),
  locked: (message: string) => new AppException('ACCOUNT_LOCKED', message, HttpStatus.TOO_MANY_REQUESTS),
  tooMany: (message: string) => new AppException('RATE_LIMITED', message, HttpStatus.TOO_MANY_REQUESTS),
  unprocessable: (message: string, details: unknown = null) =>
    new AppException('UNPROCESSABLE', message, HttpStatus.UNPROCESSABLE_ENTITY, details),
  provider: (message: string, details: unknown = null) =>
    new AppException('PAYMENT_PROVIDER_ERROR', message, HttpStatus.BAD_GATEWAY, details),
  unavailable: (message: string, details: unknown = null) =>
    new AppException('SERVICE_UNAVAILABLE', message, HttpStatus.SERVICE_UNAVAILABLE, details),
};
