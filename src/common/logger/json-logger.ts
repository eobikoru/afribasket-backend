import { LoggerService } from '@nestjs/common';
import { redact } from './redact';

export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  private write(level: string, message: unknown, context?: string, trace?: string): void {
    const payload: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      context,
    };
    if (message instanceof Error) {
      payload.msg = redact(message.message);
      payload.err = message.name;
    } else if (typeof message === 'string') {
      payload.msg = redact(message);
    } else {
      const redacted = redact(message);
      if (redacted && typeof redacted === 'object' && !Array.isArray(redacted)) {
        Object.assign(payload, redacted);
      } else {
        payload.msg = redacted;
      }
    }
    if (trace) payload.trace = redact(trace);
    const line = JSON.stringify(payload);
    if (level === 'error') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }
}
