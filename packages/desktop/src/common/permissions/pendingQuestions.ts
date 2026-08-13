/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { MAX_NOTCH_CHOICE_KEYS, type VoicePermissionRequest } from '@/common/types/voiceStage';

/**
 * A task that has run out of information, and the answer that lets it carry on.
 *
 * `pendingAsks.ts` beside this file suspends a call on a *decision* — may this
 * run, yes or no. This suspends one on a *value*: the form wants a date of
 * birth and nobody has told the application what it is. Same machinery, same
 * directory, and deliberately not the same module, because the two differ on
 * the one thing that matters most about them — what happens when nobody
 * answers.
 *
 * **An unanswered decision is refused. An unanswered question is not invented.**
 * A permission that times out has a safe direction to fail in, and takes it. A
 * question has none: there is no value that is safely wrong, so a question that
 * expires comes back saying it expired, and the caller has to deal with a field
 * it could not fill rather than being handed a plausible one. Everything in
 * this file exists to keep that promise — which is why an answer that does not
 * fit the question leaves the question open instead of resolving it with
 * something the caller will write into a document.
 */

/**
 * What kind of answer the asker will accept.
 *
 * `choice` carries the options in the words the *document* uses, not the user
 * interface's: a dropdown's options are values that will be written back into
 * the PDF, so translating them would produce a form filled in with a language
 * the form does not speak.
 *
 * `confirm` is the exception, and the reason it is not just a two-option
 * `choice`. It resolves to the canonical `yes`/`no` below whatever localised
 * labels were shown, so a user who clicks "Ja" does not hand the caller a
 * string it has to know German to understand.
 */
export type QuestionShape = { kind: 'text' } | { kind: 'choice'; options: readonly string[] } | { kind: 'confirm' };

/** The canonical answers to a `confirm`, whatever the buttons said. */
export const CONFIRM_YES = 'yes';
export const CONFIRM_NO = 'no';

/** What a caller wants to know. */
export type QuestionRequest = {
  /**
   * Identifies the question. The same id twice is the same question.
   *
   * Stable rather than generated so that a task which retries — reconnected,
   * resumed, asked again by a model that forgot it already had asked — joins
   * the question already on screen instead of stacking a second identical card
   * in front of the user.
   */
  id: string;
  /** The question, already translated, in words a person can answer. */
  prompt: string;
  /** Why it is being asked, when that is not obvious from the prompt alone. */
  context?: string;
  shape: QuestionShape;
};

/** One question waiting, in the shape a card can be drawn from. */
export type OutstandingQuestion = QuestionRequest & {
  /** The run that is suspended on it, so ending that run can release it. */
  taskId: string;
  askedAt: number;
};

/**
 * How a question ended.
 *
 * Four outcomes and not one of them is a value the caller may treat as an
 * answer unless it says `answered`. Discriminated by a string rather than a
 * boolean because this project does not run `strictNullChecks`, and a
 * `{ ok: false }` union does not narrow here.
 */
export type QuestionOutcome =
  | { status: 'answered'; value: string }
  /** The user said to leave it — "I don't know", "skip that one". */
  | { status: 'skipped' }
  /** Nobody answered in time. Not a value, and never to be turned into one. */
  | { status: 'timed-out' }
  /** The run was abandoned, or the app is closing. */
  | { status: 'cancelled' };

/**
 * How long a question stays open before it gives up.
 *
 * Much longer than the forty-five seconds a permission card waits, because the
 * two are not the same act: deciding whether a tool may run takes a glance, and
 * answering "what is your policy number" means finding the policy. Still
 * bounded — a task suspended for ever holds whatever it was working on open,
 * and the user has long since walked away.
 */
export const QUESTION_DEADLINE_MS = 3 * 60_000;

/**
 * An answer as the caller will receive it, or `null` if the question is still
 * unanswered.
 *
 * Rejecting rather than repairing is the whole point. A dropdown handed a value
 * it does not offer, or a required field handed an empty string, would be
 * written into somebody's document and reported as filled — so an answer that
 * does not fit leaves the question standing and the user is asked again.
 */
export const normalizeAnswer = (shape: QuestionShape, raw: string): string | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (shape.kind === 'text') return trimmed;

  if (shape.kind === 'confirm') {
    // Only the two canonical words. The card sends these; a spoken "yes" is
    // turned into one before it arrives, because deciding what counts as
    // agreement in thirteen languages is not this module's job.
    if (trimmed.toLowerCase() === CONFIRM_YES) return CONFIRM_YES;
    if (trimmed.toLowerCase() === CONFIRM_NO) return CONFIRM_NO;
    return null;
  }

  // Matched case-insensitively and handed back in the document's own spelling:
  // the user picking "male" must write `Male` if that is what the form declared.
  const matched = shape.options.find((option) => option.toLowerCase() === trimmed.toLowerCase());
  return matched ?? null;
};

/**
 * The options a card or a notch should offer, in the order they are numbered.
 *
 * `confirm` is expanded here rather than at each surface so that the two cannot
 * disagree about which of yes and no is option one.
 */
export const answerOptions = (shape: QuestionShape, labels: { yes: string; no: string }): readonly string[] => {
  if (shape.kind === 'choice') return shape.options;
  if (shape.kind === 'confirm') return [labels.yes, labels.no];
  return [];
};

/** The canonical value behind the option at `index`, or null if there is none. */
export const optionValue = (shape: QuestionShape, index: number): string | null => {
  if (shape.kind === 'confirm') return index === 0 ? CONFIRM_YES : index === 1 ? CONFIRM_NO : null;
  if (shape.kind === 'choice') return shape.options[index] ?? null;
  return null;
};

/**
 * A question as the notch shows it.
 *
 * The notch already knows how to draw a titled request with numbered options —
 * it was built for permission cards and has been waiting for a publisher ever
 * since. Reused rather than given a second vocabulary of its own: a user
 * holding the talk key is looking at the notch and nothing else, and a question
 * that appears only in the main window stops the task silently.
 *
 * Everything here is already translated. That window loads no i18n runtime.
 */
export const toNotchRequest = (
  question: OutstandingQuestion,
  labels: { yes: string; no: string; hintKeys: string; hintSpeak: string }
): VoicePermissionRequest => {
  const options = answerOptions(question.shape, labels);
  return {
    id: question.id,
    title: question.prompt,
    // A question with no options cannot be answered by pressing a number, so it
    // says how it *can* be answered rather than offering a shortcut that does
    // nothing. Past three, the numbering stops being readable at a glance and
    // the rest have to be clicked in the app — see `MAX_NOTCH_CHOICE_KEYS`.
    hint: options.length === 0 ? labels.hintSpeak : labels.hintKeys,
    options: options.slice(0, MAX_NOTCH_CHOICE_KEYS),
  };
};

/**
 * The questions currently suspending work, and the promises waiting on them.
 *
 * Held in memory and nowhere else, which is a decision rather than an omission.
 * What is suspended is a running function — its closure holds the half-filled
 * form, the file handle and the rest of the plan — and none of that survives the
 * process. A question written to disk would come back after a restart with
 * nowhere to deliver its answer: the user would type a date of birth into a card
 * that resolves nothing. So a restart cancels, the caller reports what it did
 * not manage to fill, and the user is told the truth instead of being handed a
 * card that lies.
 */
export class PendingQuestions {
  private waiting = new Map<
    string,
    {
      question: OutstandingQuestion;
      settle: (outcome: QuestionOutcome) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private listeners = new Set<(outstanding: readonly OutstandingQuestion[]) => void>();

  /**
   * @param deadlineMs how long a question waits before it reports that nobody
   *   answered. Never turns into a value — see the note on `QuestionOutcome`.
   * @param now the clock, injectable so tests do not have to wait three minutes.
   */
  constructor(
    private readonly deadlineMs: number = QUESTION_DEADLINE_MS,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Suspends the caller until the user answers, or until nobody does.
   *
   * Asking the same id twice joins the question already outstanding instead of
   * opening a second one. The second caller gets the same outcome as the first,
   * which is what "the same question" means.
   */
  ask(request: QuestionRequest, taskId: string): Promise<QuestionOutcome> {
    const existing = this.waiting.get(request.id);
    if (existing !== undefined) {
      return new Promise<QuestionOutcome>((resolve) => {
        const previous = existing.settle;
        existing.settle = (outcome) => {
          previous(outcome);
          resolve(outcome);
        };
      });
    }

    const question: OutstandingQuestion = { ...request, taskId, askedAt: this.now() };

    return new Promise<QuestionOutcome>((resolve) => {
      const settle = (outcome: QuestionOutcome): void => {
        const entry = this.waiting.get(request.id);
        if (entry === undefined) return;
        clearTimeout(entry.timer);
        this.waiting.delete(request.id);
        resolve(outcome);
        this.announce();
      };

      const timer = setTimeout(() => this.waiting.get(request.id)?.settle({ status: 'timed-out' }), this.deadlineMs);
      this.waiting.set(request.id, { question, settle, timer });
      this.announce();
    });
  }

  /** What is waiting, oldest first, for whatever is drawing the cards. */
  outstanding(): OutstandingQuestion[] {
    return [...this.waiting.values()].map((entry) => entry.question).sort((a, b) => a.askedAt - b.askedAt);
  }

  /**
   * The user's answer.
   *
   * Returns whether it was taken. A rejected answer leaves the question open on
   * purpose: the alternative is resolving the caller with a value the field
   * will not accept, which is how a form ends up looking filled and not being.
   */
  answer(id: string, raw: string): boolean {
    const entry = this.waiting.get(id);
    if (entry === undefined) return false;

    const value = normalizeAnswer(entry.question.shape, raw);
    if (value === null) return false;

    entry.settle({ status: 'answered', value });
    return true;
  }

  /** The user chose a numbered option, from the notch or from the card. */
  answerByIndex(id: string, index: number): boolean {
    const entry = this.waiting.get(id);
    if (entry === undefined) return false;

    const value = optionValue(entry.question.shape, index);
    if (value === null) return false;

    return this.answer(id, value);
  }

  /** The user would rather leave it blank than answer it. */
  skip(id: string): void {
    this.waiting.get(id)?.settle({ status: 'skipped' });
  }

  /** Everything this run left outstanding is released, unanswered. */
  taskEnded(taskId: string): void {
    // Snapshot first: settling removes the entry from the map being walked.
    const open = [...this.waiting.entries()];
    for (const [id, entry] of open) {
      if (entry.question.taskId === taskId) this.waiting.get(id)?.settle({ status: 'cancelled' });
    }
  }

  /** The window is closing, or the conversation is over. */
  cancelAll(): void {
    const open = [...this.waiting.keys()];
    for (const id of open) this.waiting.get(id)?.settle({ status: 'cancelled' });
  }

  /** For whatever is drawing the cards. Fires immediately with what is open. */
  subscribe(listener: (outstanding: readonly OutstandingQuestion[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.outstanding());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private announce(): void {
    const outstanding = this.outstanding();
    for (const listener of this.listeners) listener(outstanding);
  }
}
