import { mkdir, writeFile } from 'fs/promises';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { AppConfig } from '../config/configuration';
import type { EmailSender, OutboundEmail } from './email.sender';

@Injectable()
export class ResendEmailSender implements EmailSender {
  private readonly logger = new Logger(ResendEmailSender.name);
  private readonly client: Resend | null;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const apiKey = config.get('email', { infer: true }).resendApiKey;
    this.client = apiKey ? new Resend(apiKey) : null;
  }

  async send(message: OutboundEmail): Promise<void> {
    const from = this.config.get('email', { infer: true }).from;
    if (!this.client) {
      if (this.config.get('nodeEnv', { infer: true }) === 'development') {
        await mkdir('tmp', { recursive: true });
        await writeFile(
          'tmp/last-email.txt',
          `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`,
          'utf8',
        );
      }
      this.logger.log({ msg: 'email_not_sent', to: message.to, subject: message.subject });
      return;
    }
    const result = await this.client.emails.send({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (result.error) {
      this.logger.error({ msg: 'email_failed', to: message.to, subject: message.subject });
      throw new Error('Email provider rejected the message');
    }
  }
}
