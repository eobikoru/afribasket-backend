import { createVerify } from 'crypto';
import crc32 from 'buffer-crc32';

export function payPalCrc(body: Buffer): string {
  return crc32.unsigned(body).toString();
}

export function assertPayPalCertUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('invalid cert url');
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !(host === 'paypal.com' || host.endsWith('.paypal.com'))) {
    throw new Error('invalid cert url');
  }
}

export function verifyPayPalTransmission(input: {
  transmissionId: string;
  transmissionTime: string;
  webhookId: string;
  rawBody: Buffer;
  signature: string;
  certPem: string;
  authAlgo?: string;
  now?: Date;
  maxSkewMs?: number;
}): boolean {
  const algo = (input.authAlgo ?? 'SHA256withRSA').toUpperCase();
  if (!algo.includes('SHA256')) return false;
  const sentAt = new Date(input.transmissionTime);
  if (Number.isNaN(sentAt.getTime())) return false;
  const skew = Math.abs((input.now ?? new Date()).getTime() - sentAt.getTime());
  if (skew > (input.maxSkewMs ?? 5 * 60 * 1000)) return false;
  const message = `${input.transmissionId}|${input.transmissionTime}|${input.webhookId}|${payPalCrc(input.rawBody)}`;
  const verifier = createVerify('RSA-SHA256');
  verifier.update(message);
  verifier.end();
  try {
    return verifier.verify(input.certPem, Buffer.from(input.signature, 'base64'));
  } catch {
    return false;
  }
}
