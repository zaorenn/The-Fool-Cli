/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  fieldsToAsk,
  pdfFillFailed,
  pdfReadFailed,
  planAnswers,
  readableFieldName,
  type PdfAnswer,
  type PdfField,
} from '@/common/voice/pdfForm';
import { askUser, questionsTaskEnded } from '@renderer/services/permissions/questionStore';
import type { QuestionShape } from '@/common/permissions/pendingQuestions';
import { CONFIRM_YES } from '@/common/permissions/pendingQuestions';
import type { Translate } from './types';

/**
 * Filling in a form, stopping to ask whenever the form wants something nobody
 * has said.
 *
 * This is the first thing built on the ask channel, and the reason it exists.
 * Everything else the assistant does either has what it needs or gives up; a
 * form is the case where carrying on *requires* a fact only the user has, and
 * where both alternatives to asking are bad in a way the user finds out about
 * later. Guessing writes a wrong date of birth into a document that gets filed.
 * Leaving it blank hands back a form that looks finished.
 *
 * So: the fields are read, whatever the model was told is matched against them,
 * and every required field still empty suspends the run on a question. The user
 * answers on the card or at the notch, and the run picks up where it stopped.
 *
 * Nothing here touches a pointer or a window. The document is opened, written
 * and closed by `pdf-lib` in the main process, and the copy lands beside the
 * original — see `pdfFormBridge`.
 */

/** What the model already knows, in whatever shape it chose to say it. */
export type KnownValue = { field: string; value: string };

/**
 * Discriminated on a string rather than on `ok`, deliberately.
 *
 * `strictNullChecks` is off in this project, so a boolean literal is not a
 * discriminant the compiler will follow — see the guards in `pdfForm.ts`.
 */
export type PdfFillOutcome =
  | {
      status: 'filled';
      writtenTo: string;
      filled: number;
      /** Named in words, for saying out loud. Empty when the form is complete. */
      unfilled: string[];
    }
  | { status: 'failed'; error: string };

/**
 * Matches what the model said against what the form declared.
 *
 * A model handed `txtSurname_1` will say "surname", because that is what it was
 * shown. Both spellings are accepted and the document's own name is what comes
 * back, since that is the only one `pdf-lib` will take.
 */
export const matchField = (fields: readonly PdfField[], named: string): PdfField | null => {
  const wanted = named.trim().toLowerCase();
  if (wanted.length === 0) return null;

  const exact = fields.find((field) => field.name.toLowerCase() === wanted);
  if (exact) return exact;

  return fields.find((field) => readableFieldName(field.name).toLowerCase() === wanted) ?? null;
};

/** The question a field asks, in the shape the ask channel wants it. */
export const shapeOf = (field: PdfField): QuestionShape => {
  if (field.kind === 'checkbox') return { kind: 'confirm' };
  if (field.options && field.options.length > 0) return { kind: 'choice', options: field.options };
  return { kind: 'text' };
};

/**
 * A stable id for the question this field raises.
 *
 * Built from the document and the field rather than from a counter, so the same
 * field asked about twice — a retried run, a model that forgot — joins the
 * question already on screen instead of stacking a second identical card.
 */
export const questionIdFor = (path: string, fieldName: string): string => `pdf:${path}:${fieldName}`;

/**
 * Runs the whole fill, asking for what is missing.
 *
 * `taskId` scopes the questions: if the run is abandoned, everything it left
 * outstanding is released rather than sitting on the user's screen asking about
 * a form nobody is filling any more.
 */
export const fillPdfWithQuestions = async (
  t: Translate,
  path: string,
  known: readonly KnownValue[],
  taskId: string,
  onProgress?: (detail: string) => void
): Promise<PdfFillOutcome> => {
  const document = await ipcBridge.pdfForm.read.invoke({ path: path.trim() });
  if (pdfReadFailed(document)) {
    return {
      status: 'failed',
      error:
        document.reason === 'not-a-form'
          ? t('settings.voice.conversationPdfNoFields')
          : t('settings.voice.conversationPdfUnreadable'),
    };
  }

  const { fields } = document;
  const answers: PdfAnswer[] = [];

  // What the model already had. Anything it named that the form does not have
  // is dropped here rather than carried to `planAnswers` as a rejection — an
  // invented field is not something to report to the user, it is something the
  // model made up, and the field it was meant for will be asked about below.
  for (const entry of known) {
    const field = matchField(fields, entry.field);
    if (field !== null) answers.push({ name: field.name, value: entry.value });
  }

  const alreadyAnswered = new Set(answers.map((answer) => answer.name));
  const missing = fieldsToAsk(fields).filter((field) => !alreadyAnswered.has(field.name));

  for (const field of missing) {
    const readable = readableFieldName(field.name);
    // A name that survives as nothing readable is asked about by its position
    // instead, which is at least true. `readableFieldName` returns empty on
    // purpose for exactly this.
    const prompt =
      readable.length > 0
        ? t('settings.voice.conversationPdfAskField', { field: readable })
        : t('settings.voice.conversationPdfAskUnnamed');

    onProgress?.(prompt);

    const outcome = await askUser(
      {
        id: questionIdFor(path, field.name),
        prompt,
        context: t('settings.voice.conversationPdfAskContext'),
        shape: shapeOf(field),
      },
      taskId
    );

    // Only an answer is an answer. A question that timed out, was skipped or
    // was cancelled leaves the field alone — it does not become a blank string
    // written into the document and reported as filled.
    if (outcome.status !== 'answered') continue;

    const value = field.kind === 'checkbox' ? (outcome.value === CONFIRM_YES ? 'on' : 'off') : outcome.value;
    answers.push({ name: field.name, value });
  }

  // Judged one last time against the form itself. `planAnswers` is the single
  // place that refuses a value a field will not take, and it runs even over
  // answers that came straight from the user: a typed date is still a value
  // that has to fit.
  const plan = planAnswers(fields, answers);
  if (plan.write.length === 0) {
    questionsTaskEnded(taskId);
    return { status: 'failed', error: t('settings.voice.conversationPdfNothingToWrite') };
  }

  const written = await ipcBridge.pdfForm.fill.invoke({ path: path.trim(), answers: plan.write });
  if (pdfFillFailed(written)) {
    questionsTaskEnded(taskId);
    return {
      status: 'failed',
      error:
        written.reason === 'write-failed'
          ? t('settings.voice.conversationPdfWriteFailed')
          : t('settings.voice.conversationPdfUnreadable'),
    };
  }

  // Everything the document still wants, named in words. This is the sentence
  // that stops the assistant reporting a half-filled form as done, so it is
  // built from what the document says rather than from what was attempted.
  const filled = new Set(written.filled);
  const unfilled = fields
    .filter((field) => field.required === true && !filled.has(field.name))
    .map((field) => readableFieldName(field.name) || field.name);

  // The run is over; nothing it asked should outlive it.
  questionsTaskEnded(taskId);

  return { status: 'filled', writtenTo: written.writtenTo, filled: written.filled.length, unfilled };
};
