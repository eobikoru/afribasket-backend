const BANNED_TERMS = [
  'palm wine',
  'hard cider',
  'hard seltzer',
  'alcoholic',
  'alcohol',
  'liquor',
  'whiskey',
  'whisky',
  'vodka',
  'brandy',
  'tequila',
  'liqueur',
  'schnapps',
  'ogogoro',
  'burukutu',
  'ethanol',
  'spirits',
  'beer',
  'wine',
  'rum',
  'gin',
];

export interface AgeRestrictionInput {
  name?: string | null;
  description?: string | null;
  shortDescription?: string | null;
  brand?: string | null;
  attributes?: unknown;
}

export function findAgeRestriction(input: AgeRestrictionInput): string | null {
  const raw = [input.name, input.brand, input.shortDescription, input.description]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .toLowerCase()
    .replace(/non-alcoholic|alcohol-free|zero[- ]alcohol/g, ' ');
  for (const term of BANNED_TERMS) {
    const pattern = new RegExp(`(^|[^a-z])${term.replace(/\s+/g, '\\s+')}([^a-z]|$)`, 'i');
    if (pattern.test(raw)) return term;
  }
  if (input.attributes && typeof input.attributes === 'object') {
    const record = input.attributes as Record<string, unknown>;
    if (record.ageRestricted === true || record.containsAlcohol === true || record.alcohol === true) {
      return 'age-restricted attribute';
    }
  }
  return null;
}
