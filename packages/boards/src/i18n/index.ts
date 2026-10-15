import { en } from './en';
import { id } from './id';

export const LOCALES = { en, id } as const;
export type Locale = keyof typeof LOCALES;

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Picks the first supported locale from the browser's list; English otherwise (PRD 11.5). */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'id' || base === 'in') return 'id';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export function formatCoins(locale: Locale, n: number): string {
  return new Intl.NumberFormat(locale === 'id' ? 'id-ID' : 'en-US').format(n);
}

/** Simple {placeholder} translator. Numbers are formatted per locale (1,500 vs 1.500). */
export function makeTranslator(locale: Locale): Translate {
  const table = LOCALES[locale];
  return (key, params) => {
    const raw = table[key] ?? en[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
      const v = params[name];
      if (v === undefined) return `{${name}}`;
      return typeof v === 'number' ? formatCoins(locale, v) : v;
    });
  };
}

export { en, id };
