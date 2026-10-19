const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'UK']);

export function isIsoCountry(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code) || NOT_COUNTRIES.has(code)) return false;
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
  return Boolean(name && name !== code);
}
