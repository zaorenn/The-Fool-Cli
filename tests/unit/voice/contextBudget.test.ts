import { describe, expect, it } from 'vitest';
import { REALTIME_TOOLS } from '@/common/realtime';
import { buildPersonaInstructions } from '@/common/realtime/personas';
import {
  FIXED_OVERHEAD_BUDGET_TOKENS,
  estimateTokens,
  fitHistoryToBudget,
  historyBudgetTokens,
} from '@/common/voice/contextBudget';

/**
 * The prompt and the tool schemas as a default installation sends them.
 *
 * Empty memory, no taught skills, no carried files, no session rules: this is
 * the floor, not a typical turn. Everything a real conversation accumulates is
 * added on top of what is measured here.
 */
const fixedOverhead = (): { prompt: string; schemas: string } => ({
  prompt: buildPersonaInstructions({
    presetId: 'companion',
    customInstructions: '',
    language: 'tr-TR',
    interfaceLanguage: 'tr-TR',
    wakePhrase: 'fool',
    memory: null,
    voices: [],
    carried: [],
    sessionRules: [],
    localSkills: [],
    files: [],
  } as never),
  schemas: JSON.stringify(REALTIME_TOOLS),
});

describe('spoken-turn context budget', () => {
  /**
   * The regression this exists to prevent.
   *
   * The fixed cost of every single request has to leave room for the
   * conversation and the reply, or the window overflows before anybody speaks
   * and the server truncates from the front. What sits at the front is the
   * system prompt, so the first thing lost is every instruction the assistant
   * was given.
   *
   * This used to say the app could not know the window — that the provider row
   * carried no `context_limit` and 8k had to be assumed. Half of that was true:
   * `GET /v1/models` reports nothing but an id. LM Studio's own `/api/v0/models`
   * on the same port reports `loaded_context_length`, and the spoken pipeline
   * now asks. So the marker below is measured against a real window rather than
   * a guessed one, and the test underneath it says so in tokens.
   */
  it('does not grow past what a spoken turn already costs', () => {
    const { prompt, schemas } = fixedOverhead();
    const total = estimateTokens(prompt) + estimateTokens(schemas);

    expect(total).toBeLessThan(FIXED_OVERHEAD_BUDGET_TOKENS);
  });

  /**
   * What the marker above is a proxy for, asserted directly.
   *
   * A token count on its own says nothing: it is only large or small relative
   * to a window. 64256 is what `GET /api/v0/models` reports for
   * `qwen/qwen3.5-9b` on the machine this was written on — a measurement rather
   * than a round number — and the spoken pipeline now reads it instead of
   * assuming 8192.
   *
   * This is the assertion that fails in the case that actually matters: a fixed
   * cost grown until a real conversation no longer fits behind it, whatever the
   * marker happens to have been raised to.
   */
  it('leaves a real conversation room inside the window the server reports', () => {
    const { prompt, schemas } = fixedOverhead();
    const total = estimateTokens(prompt) + estimateTokens(schemas);

    expect(historyBudgetTokens(64_256, total)).toBeGreaterThan(20_000);
  });
});

describe('fitHistoryToBudget', () => {
  const system = { role: 'system' as const, content: 'S'.repeat(400) };
  const turn = (n: number) => ({
    role: (n % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `${n} `.repeat(200),
  });

  it('never drops the system message, however tight the budget', () => {
    const history = [system, ...Array.from({ length: 40 }, (_, n) => turn(n))];

    const fitted = fitHistoryToBudget(history, 200);

    expect(fitted[0]).toBe(system);
  });

  it('drops the oldest exchanges first and keeps the newest', () => {
    const history = [system, ...Array.from({ length: 40 }, (_, n) => turn(n))];

    const fitted = fitHistoryToBudget(history, 2000);

    expect(fitted.at(-1)).toBe(history.at(-1));
    expect(fitted.length).toBeLessThan(history.length);
  });

  it('counts tokens rather than messages, so one long tool result costs what it costs', () => {
    // Sixty short spoken lines and one screen description are not the same
    // amount of context, and a message count cannot tell them apart. This is
    // the assumption `MAX_HISTORY_TURNS` was built on.
    const screenResult = { role: 'assistant' as const, content: 'x'.repeat(40_000) };
    const history = [system, screenResult, turn(1)];

    const fitted = fitHistoryToBudget(history, 1000);

    expect(fitted).not.toContain(screenResult);
    expect(fitted[0]).toBe(system);
  });

  it('leaves a conversation that already fits completely alone', () => {
    const history = [system, turn(0), turn(1)];

    expect(fitHistoryToBudget(history, 100_000)).toEqual(history);
  });
});
