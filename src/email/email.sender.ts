export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(message: OutboundEmail): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
