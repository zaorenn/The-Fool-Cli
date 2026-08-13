/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import i18next from 'i18next';
import { ipcBridge } from '@/common';
import {
  PendingQuestions,
  toNotchRequest,
  type OutstandingQuestion,
  type QuestionOutcome,
  type QuestionRequest,
} from '@/common/permissions/pendingQuestions';

/**
 * The one place a running task asks the user for something it does not know.
 *
 * A module-level singleton for the same reason `permissionStore` is one: what
 * needs the answer is a tool call, and a tool call does not belong to a page. A
 * form being filled from a spoken instruction has no window open at all, and
 * the question still has to reach somebody.
 *
 * Two surfaces, no new ones. The card in the main window is drawn by
 * `QuestionAskCard`, which subscribes here. The notch is fed from here directly,
 * over the request channel it has had since permission cards were put on it —
 * a channel which, until this file, nothing had ever published to. Whichever
 * the user answers on, the answer arrives in the same place.
 */

const pending = new PendingQuestions();

/** Notch labels, resolved at the moment of asking so a language change is picked up. */
const notchLabels = (): { yes: string; no: string; hintKeys: string; hintSpeak: string } => ({
  yes: String(i18next.t('settings.permissions.questionYes')),
  no: String(i18next.t('settings.permissions.questionNo')),
  hintKeys: String(i18next.t('settings.permissions.questionNotchKeys')),
  hintSpeak: String(i18next.t('settings.permissions.questionNotchSpeak')),
});

/**
 * Mirrors the oldest open question onto the notch, or clears it.
 *
 * One at a time, matching the card. Two questions on a strip that small is
 * how somebody answers the second while reading the first.
 */
const publishToNotch = (outstanding: readonly OutstandingQuestion[]): void => {
  const question = outstanding[0];
  ipcBridge.foolVoice.permissionRequest.emit(question === undefined ? null : toNotchRequest(question, notchLabels()));
};

/**
 * Suspends the caller until the user answers.
 *
 * Never throws and always settles: a caller left waiting for ever is a task
 * that has silently stopped, which from the user's side is the application
 * having forgotten what it was asked to do. What it settles *with* may not be
 * an answer — see `QuestionOutcome` — and a caller that treats `timed-out` as a
 * value has undone the point of the whole module.
 */
export const askUser = (request: QuestionRequest, taskId: string): Promise<QuestionOutcome> =>
  pending.ask(request, taskId);

/** For whatever is drawing the cards. Fires immediately with what is open. */
export const subscribeToQuestions = (listener: (outstanding: readonly OutstandingQuestion[]) => void): (() => void) =>
  pending.subscribe(listener);

/** The user typed or chose an answer. False when it does not fit the question. */
export const answerQuestion = (id: string, raw: string): boolean => pending.answer(id, raw);

/** The user would rather leave it blank than answer it. */
export const skipQuestion = (id: string): void => pending.skip(id);

/** Everything this run left outstanding is released, unanswered. */
export const questionsTaskEnded = (taskId: string): void => pending.taskEnded(taskId);

/**
 * Puts questions on the notch, and reads the keys pressed there to answer them.
 *
 * The main process owns the desktop-wide key hook and raises the index; the
 * question is resolved here, by the same call a click on the card would make.
 * One way to answer, one way to resolve.
 *
 * Both halves are wired here rather than when this module loads. An import that
 * reaches for `ipcBridge.foolVoice` on its own is an import that fails wherever
 * the bridge is partial or absent — which is every test that mocks it, and any
 * host without the notch. Asking still works without this; it just does not
 * reach the strip. Returns the way to stop, like every other channel the
 * application opens.
 */
export const startQuestionChannel = (): (() => void) => {
  const stopPublishing = pending.subscribe(publishToNotch);

  const stopChoices = ipcBridge.foolVoice.permissionChoice.on(({ index }) => {
    const question = pending.outstanding()[0];
    if (question === undefined) return;
    pending.answerByIndex(question.id, index);
  });

  return () => {
    stopChoices();
    stopPublishing();
    // Nothing left waiting on a window that is going away. The tasks behind
    // these are in this renderer too, and they are about to stop existing.
    pending.cancelAll();
  };
};
