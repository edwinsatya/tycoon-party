import { describe, expect, it } from 'vitest';
import { LOCALES, makeTranslator, metroCity, pickLocale } from '@rollionaire/boards';
import { ERROR_CODES } from '../src';

describe('localization (PRD 11.5)', () => {
  it('has every key in both locales', () => {
    expect(Object.keys(LOCALES.id).sort()).toEqual(Object.keys(LOCALES.en).sort());
  });

  it('translates every error code', () => {
    for (const code of ERROR_CODES) {
      expect(LOCALES.en[`error.${code}`], code).toBeTruthy();
      expect(LOCALES.id[`error.${code}`], code).toBeTruthy();
      expect(LOCALES.id[`error.${code}`]).not.toBe(LOCALES.en[`error.${code}`]);
    }
  });

  it('names every tile and card', () => {
    for (const tile of metroCity.tiles) expect(LOCALES.en[tile.key], tile.key).toBeTruthy();
    for (const deck of Object.values(metroCity.decks)) {
      for (const card of deck) {
        expect(LOCALES.en[`${card.key}.title`], card.key).toBeTruthy();
        expect(LOCALES.id[`${card.key}.text`], card.key).toBeTruthy();
      }
    }
  });

  it('formats numbers per locale', () => {
    expect(makeTranslator('en')('ev.Collected', { player: 'Dina', amount: 1500 })).toBe('Dina collected 1,500.');
    expect(makeTranslator('id')('ev.Collected', { player: 'Dina', amount: 1500 })).toBe('Dina menerima 1.500.');
  });

  it('picks the browser language, defaulting to English', () => {
    expect(pickLocale(['id-ID', 'en-US'])).toBe('id');
    expect(pickLocale(['fr-FR'])).toBe('en');
    expect(pickLocale(['en-GB', 'id'])).toBe('en');
  });
});
