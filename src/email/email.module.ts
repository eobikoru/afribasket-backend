import { Module } from '@nestjs/common';
import { EMAIL_SENDER } from './email.sender';
import { NotificationService } from './notification.service';
import { ResendEmailSender } from './resend-email.sender';

@Module({
  providers: [
    ResendEmailSender,
    { provide: EMAIL_SENDER, useExisting: ResendEmailSender },
    NotificationService,
  ],
  exports: [NotificationService, EMAIL_SENDER],
})
export class EmailModule {}
