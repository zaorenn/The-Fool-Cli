/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoicePermissionRequest } from '@/common/types/voiceStage';

/**
 * That the notch actually hears about a question.
 *
 * `fool.voice.permission-request` was built for permission cards and, until the
 * question store, had a subscriber in the main process and no publisher at all
 * anywhere. This file is what stops it going back to that: it asserts the emit,
 * so a refactor that quietly drops the notch surface fails here rather than in
 * front of somebody holding the talk key.
 */

const emitted: (VoicePermissionRequest | null)[] = [];
let choiceHandler: ((payload: { index: number }) => void) | null = null;
const stopChoice = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    foolVoice: {
      permissionRequest: {
        emit: (request: VoicePermissionRequest | null) => {
          emitted.push(request);
        },
      },
      permissionChoice: {
        on: (handler: (payload: { index: number }) => void) => {
          choiceHandler = handler;
          return stopChoice;
        },
      },
    },
  },
}));

vi.mock('i18next', () => ({
  default: {
    t: (key: string) => {
      const words: Record<string, string> = {
        'settings.permissions.questionYes': 'Yes',
        'settings.permissions.questionNo': 'No',
        'settings.permissions.questionNotchKeys': 'press a number',
        'settings.permissions.questionNotchSpeak': 'answer in the app',
      };
      return words[key] ?? key;
    },
  },
}));

const { answerQuestion, askUser, questionsTaskEnded, skipQuestion, startQuestionChannel, subscribeToQuestions } =
  await import('@renderer/services/permissions/questionStore');

/** Started per test, because the notch is wired by the channel, not by import. */
let stopChannel: () => void = () => undefined;

beforeEach(() => {
  emitted.length = 0;
  choiceHandler = null;
  stopChoice.mockClear();
  stopChannel = startQuestionChannel();
  // Subscribing publishes the empty state once; the tests care about what
  // follows.
  emitted.length = 0;
});

afterEach(() => {
  stopChannel();
});

describe('questionStore', () => {
  it('puts an open question on the notch and clears it when answered', async () => {
    const asked = askUser({ id: 'q1', prompt: 'Date of birth?', shape: { kind: 'text' } }, 'task-1');

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      id: 'q1',
      title: 'Date of birth?',
      hint: 'answer in the app',
      options: [],
    });

    answerQuestion('q1', '1980');
    await expect(asked).resolves.toEqual({ status: 'answered', value: '1980' });

    // Cleared, so the notch does not keep showing a question already answered.
    expect(emitted[emitted.length - 1]).toBeNull();
  });

  it('numbers a choice for the keyboard', async () => {
    const asked = askUser(
      { id: 'q2', prompt: 'Which?', shape: { kind: 'choice', options: ['Male', 'Female'] } },
      'task-1'
    );

    expect(emitted[0]).toEqual({ id: 'q2', title: 'Which?', hint: 'press a number', options: ['Male', 'Female'] });

    skipQuestion('q2');
    await asked;
  });

  it('shows a confirm with translated labels behind canonical values', async () => {
    const asked = askUser({ id: 'q3', prompt: 'Agree?', shape: { kind: 'confirm' } }, 'task-1');

    expect(emitted[0]?.options).toEqual(['Yes', 'No']);

    // Option two at the notch is "No", whatever the button said in the user's
    // language — the canonical value is what the caller receives.
    choiceHandler?.({ index: 1 });
    await expect(asked).resolves.toEqual({ status: 'answered', value: 'no' });
  });

  it('ignores a keypress when nothing is being asked', () => {
    expect(() => choiceHandler?.({ index: 0 })).not.toThrow();
  });

  it('releases what a run left open, and tells the notch', async () => {
    const asked = askUser({ id: 'q4', prompt: 'Anything?', shape: { kind: 'text' } }, 'task-9');

    questionsTaskEnded('task-9');

    await expect(asked).resolves.toEqual({ status: 'cancelled' });
    expect(emitted[emitted.length - 1]).toBeNull();
  });

  it('still asks when the notch was never wired up', async () => {
    // A host without the strip, or a window that never started the channel.
    // The question must still reach the card and still resolve.
    stopChannel();
    emitted.length = 0;

    const asked = askUser({ id: 'q7', prompt: 'Anything?', shape: { kind: 'text' } }, 'task-1');
    answerQuestion('q7', 'yes');

    await expect(asked).resolves.toEqual({ status: 'answered', value: 'yes' });
    expect(emitted).toEqual([]);

    stopChannel = startQuestionChannel();
  });

  it('hands the open questions to whatever draws the cards', async () => {
    const seen: string[][] = [];
    const stop = subscribeToQuestions((outstanding) => seen.push(outstanding.map((question) => question.id)));

    const asked = askUser({ id: 'q5', prompt: 'Anything?', shape: { kind: 'text' } }, 'task-1');
    answerQuestion('q5', 'something');
    await asked;

    expect(seen).toEqual([[], ['q5'], []]);
    stop();
  });

  it('stops listening and cancels everything when the window goes away', async () => {
    const asked = askUser({ id: 'q6', prompt: 'Anything?', shape: { kind: 'text' } }, 'task-1');

    stopChannel();

    expect(stopChoice).toHaveBeenCalled();
    await expect(asked).resolves.toEqual({ status: 'cancelled' });

    stopChannel = startQuestionChannel();
  });
});
