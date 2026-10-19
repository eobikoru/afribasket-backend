import { formatUsd } from '../common/money';

function layout(title: string, body: string): { html: string; text: string } {
  const text = `${title}\n\n${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`;
  const html = `<!doctype html><html><body style="font-family:Georgia,serif;color:#1c1917;line-height:1.5"><h1 style="font-size:22px">${title}</h1><div>${body}</div><p style="color:#57534e">AfriBasket · African groceries, delivered in the US</p></body></html>`;
  return { html, text };
}

export function passwordResetEmail(storefrontUrl: string, token: string) {
  const url = `${storefrontUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  return layout(
    'Reset your AfriBasket password',
    `<p>We received a request to reset your password. This link expires in 30 minutes.</p><p><a href="${url}">${url}</a></p><p>If you did not ask for this, you can ignore the email.</p>`,
  );
}

export function orderEmail(input: {
  title: string;
  orderNumber: string;
  totalCents?: number;
  detail: string;
}) {
  const amount = input.totalCents == null ? '' : ` · ${formatUsd(input.totalCents)}`;
  return layout(input.title, `<p>Order <strong>${input.orderNumber}</strong>${amount}</p><p>${input.detail}</p>`);
}
