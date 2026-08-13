/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  answerOptions,
  CONFIRM_NO,
  CONFIRM_YES,
  normalizeAnswer,
  optionValue,
  PendingQuestions,
  toNotchRequest,
  type QuestionShape,
} from '@/common/permissions/pendingQuestions';

const TEXT: QuestionShape = { kind: 'text' };
const CHOICE: QuestionShape = { kind: 'choice', options: ['Male', 'Female', 'Prefer not to say'] };

describe('normalizeAnswer', () => {
  it('trims a text answer and refuses an empty one', () => {
    expect(normalizeAnswer(TEXT, '  12 March 1980 ')).toBe('12 March 1980');
    expect(normalizeAnswer(TEXT, '   ')).toBeNull();
  });

  it("hands a choice back in the document's own spelling", () => {
    // The user says "male"; the form declared `Male` and that is what gets
    // written into it.
    expect(normalizeAnswer(CHOICE, 'male')).toBe('Male');
  });

  it('refuses a choice the form does not offer', () => {
    // The whole risk of this feature: a value the field will not take, written
    // anyway, and reported as filled.
    expect(normalizeAnswer(CHOICE, 'Other')).toBeNull();
  });

  it('takes only the canonical words for a confirm', () => {
    expect(normalizeAnswer({ kind: 'confirm' }, 'YES')).toBe(CONFIRM_YES);
    expect(normalizeAnswer({ kind: 'confirm' }, 'no')).toBe(CONFIRM_NO);
    expect(normalizeAnswer({ kind: 'confirm' }, 'evet')).toBeNull();
  });
});

describe('answerOptions and optionValue', () => {
  it('expands a confirm into localised labels with canonical values behind them', () => {
    const labels = { yes: 'Ja', no: 'Nein' };
    expect(answerOptions({ kind: 'confirm' }, labels)).toEqual(['Ja', 'Nein']);
    expect(optionValue({ kind: 'confirm' }, 0)).toBe(CONFIRM_YES);
    expect(optionValue({ kind: 'confirm' }, 1)).toBe(CONFIRM_NO);
  });

  it('offers nothing to press for a text question', () => {
    expect(answerOptions(TEXT, { yes: 'Yes', no: 'No' })).toEqual([]);
    expect(optionValue(TEXT, 0)).toBeNull();
  });
});

describe('toNotchRequest', () => {
  const labels = { yes: 'Yes', no: 'No', hintKeys: 'press 1-3', hintSpeak: 'say it out loud' };

  it('numbers at most three options, because the notch is read at a glance', () => {
    const pending = new PendingQuestions(10_000);
    void pending.ask(
      { id: 'q1', prompt: 'Which one?', shape: { kind: 'choice', options: ['a', 'b', 'c', 'd'] } },
      't1'
    );

    const request = toNotchRequest(pending.outstanding()[0], labels);
    expect(request.options).toEqual(['a', 'b', 'c']);
    expect(request.hint).toBe('press 1-3');
    pending.cancelAll();
  });

  it('tells a text question how it can be answered rather than offering a key', () => {
    const pending = new PendingQuestions(10_000);
    void pending.ask({ id: 'q1', prompt: 'Date of birth?', shape: TEXT }, 't1');

    const request = toNotchRequest(pending.outstanding()[0], labels);
    expect(request.options).toEqual([]);
    expect(request.hint).toBe('say it out loud');
    expect(request.title).toBe('Date of birth?');
    pending.cancelAll();
  });
});

describe('PendingQuestions', () => {
  it('suspends the caller and resumes it with the answer', async () => {
    const pending = new PendingQuestions(10_000);
    const asked = pending.ask({ id: 'dob', prompt: 'Date of birth?', shape: TEXT }, 'fill-1');

    expect(pending.outstanding()).toHaveLength(1);
    expect(pending.answer('dob', '12 March 1980')).toBe(true);

    await expect(asked).resolves.toEqual({ status: 'answered', value: '12 March 1980' });
    expect(pending.outstanding()).toHaveLength(0);
  });

  it('keeps the question open when the answer does not fit', async () => {
    // Rejecting rather than repairing. Resolving here would hand the caller a
    // value the field cannot take, and it would be written into a document.
    const pending = new PendingQuestions(10_000);
    const asked = pending.ask({ id: 'sex', prompt: 'Which?', shape: CHOICE }, 'fill-1');

    expect(pending.answer('sex', 'Martian')).toBe(false);
    expect(pending.outstanding()).toHaveLength(1);

    expect(pending.answer('sex', 'female')).toBe(true);
    await expect(asked).resolves.toEqual({ status: 'answered', value: 'Female' });
  });

  it('reports that nobody answered rather than inventing a value', async () => {
    vi.useFakeTimers();
    try {
      const pending = new PendingQuestions(1000);
      const asked = pending.ask({ id: 'dob', prompt: 'Date of birth?', shape: TEXT }, 'fill-1');

      vi.advanceTimersByTime(1001);

      // Not a value, and never to be turned into one. A permission that expires
      // has a safe direction to fail in; a question does not.
      await expect(asked).resolves.toEqual({ status: 'timed-out' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the user leave a field blank on purpose', async () => {
    const pending = new PendingQuestions(10_000);
    const asked = pending.ask({ id: 'middle', prompt: 'Middle name?', shape: TEXT }, 'fill-1');

    pending.skip('middle');

    await expect(asked).resolves.toEqual({ status: 'skipped' });
  });

  it('releases everything a run left outstanding when the run ends', async () => {
    const pending = new PendingQuestions(10_000);
    const mine = pending.ask({ id: 'a', prompt: 'a?', shape: TEXT }, 'fill-1');
    const other = pending.ask({ id: 'b', prompt: 'b?', shape: TEXT }, 'fill-2');

    pending.taskEnded('fill-1');

    await expect(mine).resolves.toEqual({ status: 'cancelled' });
    expect(pending.outstanding().map((question) => question.id)).toEqual(['b']);

    pending.cancelAll();
    await expect(other).resolves.toEqual({ status: 'cancelled' });
  });

  it('joins a question already outstanding rather than stacking a second card', async () => {
    // A model that forgot it had already asked, or a task that reconnected. Two
    // identical cards is how a user answers the second while reading the first.
    const pending = new PendingQuestions(10_000);
    const first = pending.ask({ id: 'dob', prompt: 'Date of birth?', shape: TEXT }, 'fill-1');
    const again = pending.ask({ id: 'dob', prompt: 'Date of birth?', shape: TEXT }, 'fill-1');

    expect(pending.outstanding()).toHaveLength(1);
    pending.answer('dob', '1980');

    await expect(first).resolves.toEqual({ status: 'answered', value: '1980' });
    await expect(again).resolves.toEqual({ status: 'answered', value: '1980' });
  });

  it('answers by the number the user pressed on the notch', async () => {
    const pending = new PendingQuestions(10_000);
    const asked = pending.ask({ id: 'sex', prompt: 'Which?', shape: CHOICE }, 'fill-1');

    expect(pending.answerByIndex('sex', 1)).toBe(true);

    await expect(asked).resolves.toEqual({ status: 'answered', value: 'Female' });
  });

  it('ignores a number that reaches past the options', async () => {
    const pending = new PendingQuestions(10_000);
    const asked = pending.ask({ id: 'sex', prompt: 'Which?', shape: CHOICE }, 'fill-1');

    expect(pending.answerByIndex('sex', 9)).toBe(false);
    expect(pending.outstanding()).toHaveLength(1);

    pending.cancelAll();
    await expect(asked).resolves.toEqual({ status: 'cancelled' });
  });

  it('answering or skipping something unknown changes nothing and does not throw', () => {
    const pending = new PendingQuestions(10_000);
    expect(pending.answer('nope', 'x')).toBe(false);
    expect(pending.answerByIndex('nope', 0)).toBe(false);
    expect(() => pending.skip('nope')).not.toThrow();
  });

  it('tells subscribers what is open, starting immediately', async () => {
    const pending = new PendingQuestions(10_000);
    const seen: number[] = [];
    const stop = pending.subscribe((outstanding) => seen.push(outstanding.length));

    const asked = pending.ask({ id: 'a', prompt: 'a?', shape: TEXT }, 'fill-1');
    pending.answer('a', 'yes');
    await asked;

    // Empty on subscribe, one when it opened, empty again when it resolved.
    expect(seen).toEqual([0, 1, 0]);
    stop();
  });
});
