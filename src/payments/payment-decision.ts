export type PaymentCaptureDecision = 'already_settled' | 'mismatch' | 'capture';

const SETTLED = new Set(['completed', 'refunded', 'partially_refunded']);

export function decidePaymentCapture(input: {
  orderStatus: string;
  paymentStatus: string;
  orderTotalCents: number;
  paidAmountCents: number;
}): PaymentCaptureDecision {
  if (SETTLED.has(input.paymentStatus)) return 'already_settled';
  if (input.orderStatus !== 'pending' || input.paidAmountCents !== input.orderTotalCents) return 'mismatch';
  return 'capture';
}
