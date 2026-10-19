import type { CookieOptions, Response } from 'express';

export const CART_COOKIE = 'ab_cart';
export const REFRESH_COOKIE = 'ab_refresh';
export const CART_HEADER = 'x-cart-token';

export function cookieOptions(secure: boolean, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function setCookie(res: Response, name: string, value: string, secure: boolean, maxAgeMs: number): void {
  res.cookie(name, value, cookieOptions(secure, maxAgeMs));
}

export function clearCookie(res: Response, name: string, secure: boolean): void {
  res.clearCookie(name, cookieOptions(secure, 0));
}
