import { describe, expect, it } from 'vitest';
import { makeTranslator } from '@rollionaire/boards';
import { type GameEvent, makeSettings, narrate } from '@rollionaire/engine';
import { runMatch, summarize, type BotLevel } from '../src';

const LEVELS: BotLevel[] = ['casual', 'smart', 'shark'];

describe('bot matches', () => {
  it('finish cleanly in Classic: no crashes, stuck games, invariant breaks or illegal intents', () => {
    const results = Array.from({ length: 60 }, (_, i) =>
      runMatch({ seed: `ci-${i}`, levels: Array.from({ length: 2 + (i % 5) }, (_, j) => LEVELS[(i + j) % 3]!) }),
    );
    const s = summarize(results);
    expect(s.samples).toEqual({});
    expect(s.crashes).toBe(0);
    expect(s.stuck).toBe(0);
    expect(s.invariantViolations).toBe(0);
    expect(s.botErrors).toBe(0);
    expect(s.finished).toBeGreaterThanOrEqual(57);
  });

  it('finish cleanly in Blitz', () => {
    const settings = makeSettings('blitz');
    const results = Array.from({ length: 30 }, (_, i) =>
      runMatch({ seed: `blitz-${i}`, levels: ['smart', 'shark', 'casual', 'smart'], settings }),
    );
    const s = summarize(results);
    expect(s.crashes + s.stuck + s.invariantViolations + s.botErrors).toBe(0);
    expect(s.finished).toBe(30);
  });

  it('produce a readable log in both languages', () => {
    const seen = new Map<string, GameEvent>();
    let last: Parameters<typeof narrate>[1] | null = null;
    runMatch({
      seed: 'narrate',
      levels: ['smart', 'casual', 'shark', 'casual'],
      onEvents: (events, state) => {
        for (const ev of events) seen.set(ev.t, ev);
        last = state;
      },
    });
    expect(seen.size).toBeGreaterThan(20);
    for (const locale of ['en', 'id'] as const) {
      const t = makeTranslator(locale);
      for (const ev of seen.values()) {
        const line = narrate(ev, last!, t);
        if (line === null) continue;
        expect(line, `${locale} ${ev.t}`).not.toMatch(/[{}]|ev\.|tile\./);
      }
    }
  });
});
