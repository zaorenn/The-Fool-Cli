/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfField, PdfFillResult, PdfReadResult } from '@/common/voice/pdfForm';
import type { QuestionOutcome, QuestionRequest } from '@/common/permissions/pendingQuestions';

const readPdf = vi.fn<(input: { path: string }) => Promise<PdfReadResult>>();
const fillPdf =
  vi.fn<(input: { path: string; answers: { name: string; value: string }[] }) => Promise<PdfFillResult>>();

vi.mock('@/common', () => ({
  ipcBridge: {
    pdfForm: {
      read: { invoke: (input: { path: string }) => readPdf(input) },
      fill: { invoke: (input: { path: string; answers: { name: string; value: string }[] }) => fillPdf(input) },
    },
  },
}));

/** Answers keyed by the question's stable id, so a test can script the user. */
let scripted: Map<string, QuestionOutcome>;
const asked: QuestionRequest[] = [];
const endedTasks: string[] = [];

vi.mock('@renderer/services/permissions/questionStore', () => ({
  askUser: (request: QuestionRequest): Promise<QuestionOutcome> => {
    asked.push(request);
    return Promise.resolve(scripted.get(request.id) ?? { status: 'timed-out' });
  },
  questionsTaskEnded: (taskId: string): void => {
    endedTasks.push(taskId);
  },
}));

const { fillPdfWithQuestions, matchField, questionIdFor, shapeOf } =
  await import('@renderer/pages/voice/runtime/pdfTool');

/** The key, not a translation. Enough to tell the sentences apart. */
const t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const field = (over: Partial<PdfField> & { name: string }): PdfField => ({ kind: 'text', value: '', ...over });

const FORM: PdfField[] = [
  field({ name: 'txtSurname_1', required: true }),
  field({ name: 'txtGivenName', required: true }),
  field({ name: 'txtNickname', required: false }),
  field({ name: 'chkAgree', kind: 'checkbox', required: true }),
];

const written = (answers: { name: string; value: string }[]): PdfFillResult => ({
  ok: true,
  writtenTo: 'C:/forms/visa-filled.pdf',
  filled: answers.map((answer) => answer.name),
  skipped: [],
});

beforeEach(() => {
  scripted = new Map();
  asked.length = 0;
  endedTasks.length = 0;
  readPdf.mockReset();
  fillPdf.mockReset();
  readPdf.mockResolvedValue({ ok: true, fields: FORM, pages: 2 });
  fillPdf.mockImplementation((input) => Promise.resolve(written(input.answers)));
});

describe('matchField', () => {
  it('accepts the machine name and the words a person would use', () => {
    expect(matchField(FORM, 'txtSurname_1')?.name).toBe('txtSurname_1');
    expect(matchField(FORM, 'surname')?.name).toBe('txtSurname_1');
    expect(matchField(FORM, 'Given name')?.name).toBe('txtGivenName');
  });

  it('refuses a field the form does not have', () => {
    // The model inventing a field is the failure this whole path guards.
    expect(matchField(FORM, 'maidenName')).toBeNull();
    expect(matchField(FORM, '   ')).toBeNull();
  });
});

describe('shapeOf', () => {
  it('asks a checkbox as a yes or no and a dropdown as its own options', () => {
    expect(shapeOf(field({ name: 'chkAgree', kind: 'checkbox' }))).toEqual({ kind: 'confirm' });
    expect(shapeOf(field({ name: 'ddSex', kind: 'dropdown', options: ['Male', 'Female'] }))).toEqual({
      kind: 'choice',
      options: ['Male', 'Female'],
    });
    expect(shapeOf(field({ name: 'txtName' }))).toEqual({ kind: 'text' });
  });
});

describe('fillPdfWithQuestions', () => {
  it('asks for every required field it was not told, and carries on with the answers', async () => {
    scripted.set(questionIdFor('C:/forms/visa.pdf', 'txtGivenName'), { status: 'answered', value: 'Ada' });
    scripted.set(questionIdFor('C:/forms/visa.pdf', 'chkAgree'), { status: 'answered', value: 'yes' });

    const outcome = await fillPdfWithQuestions(
      t,
      'C:/forms/visa.pdf',
      [{ field: 'surname', value: 'Lovelace' }],
      'task-1'
    );

    // The surname was known, so it was never asked about; the other two were.
    expect(asked.map((question) => question.id)).toEqual([
      questionIdFor('C:/forms/visa.pdf', 'txtGivenName'),
      questionIdFor('C:/forms/visa.pdf', 'chkAgree'),
    ]);

    expect(fillPdf).toHaveBeenCalledTimes(1);
    expect(fillPdf.mock.calls[0][0].answers).toEqual([
      { name: 'txtSurname_1', value: 'Lovelace' },
      { name: 'txtGivenName', value: 'Ada' },
      // A confirm comes back canonical and is turned into what pdf-lib takes.
      { name: 'chkAgree', value: 'on' },
    ]);

    expect(outcome).toEqual({
      status: 'filled',
      writtenTo: 'C:/forms/visa-filled.pdf',
      filled: 3,
      unfilled: [],
    });
  });

  it('never asks about an optional field', async () => {
    // Forty optional boxes would otherwise be forty questions nobody agreed to.
    scripted.set(questionIdFor('C:/f.pdf', 'txtSurname_1'), { status: 'answered', value: 'a' });
    scripted.set(questionIdFor('C:/f.pdf', 'txtGivenName'), { status: 'answered', value: 'b' });
    scripted.set(questionIdFor('C:/f.pdf', 'chkAgree'), { status: 'answered', value: 'no' });

    await fillPdfWithQuestions(t, 'C:/f.pdf', [], 'task-1');

    expect(asked.some((question) => question.id.includes('txtNickname'))).toBe(false);
  });

  it('leaves a field alone when nobody answered, and names it as still empty', async () => {
    // The whole point. An unanswered question is not a blank string written
    // into the document and reported as filled.
    scripted.set(questionIdFor('C:/f.pdf', 'txtSurname_1'), { status: 'answered', value: 'Lovelace' });
    scripted.set(questionIdFor('C:/f.pdf', 'txtGivenName'), { status: 'timed-out' });
    scripted.set(questionIdFor('C:/f.pdf', 'chkAgree'), { status: 'skipped' });

    const outcome = await fillPdfWithQuestions(t, 'C:/f.pdf', [], 'task-1');

    expect(fillPdf.mock.calls[0][0].answers).toEqual([{ name: 'txtSurname_1', value: 'Lovelace' }]);
    expect(outcome).toEqual({
      status: 'filled',
      writtenTo: 'C:/forms/visa-filled.pdf',
      filled: 1,
      unfilled: ['Given name', 'Agree'],
    });
  });

  it('reports what the document itself refused, not what was attempted', async () => {
    // `filled` comes back from the writer. A field the library would not take
    // has to surface as still empty even though an answer was sent for it.
    scripted.set(questionIdFor('C:/f.pdf', 'txtSurname_1'), { status: 'answered', value: 'Lovelace' });
    scripted.set(questionIdFor('C:/f.pdf', 'txtGivenName'), { status: 'answered', value: 'Ada' });
    scripted.set(questionIdFor('C:/f.pdf', 'chkAgree'), { status: 'answered', value: 'yes' });
    fillPdf.mockResolvedValue({
      ok: true,
      writtenTo: 'C:/out.pdf',
      filled: ['txtSurname_1', 'txtGivenName'],
      skipped: ['chkAgree'],
    });

    const outcome = await fillPdfWithQuestions(t, 'C:/f.pdf', [], 'task-1');

    expect(outcome).toEqual({ status: 'filled', writtenTo: 'C:/out.pdf', filled: 2, unfilled: ['Agree'] });
  });

  it('tells a document that is not a form apart from one it could not open', async () => {
    readPdf.mockResolvedValue({ ok: false, reason: 'not-a-form' });
    await expect(fillPdfWithQuestions(t, 'C:/f.pdf', [], 'task-1')).resolves.toEqual({
      status: 'failed',
      error: 'settings.voice.conversationPdfNoFields',
    });

    readPdf.mockResolvedValue({ ok: false, reason: 'unreadable' });
    await expect(fillPdfWithQuestions(t, 'C:/f.pdf', [], 'task-1')).resolves.toEqual({
      status: 'failed',
      error: 'settings.voice.conversationPdfUnreadable',
    });

    expect(fillPdf).not.toHaveBeenCalled();
  });

  it('writes nothing when nothing was answered', async () => {
    // Every question timed out. A copy written here would be identical to the
    // original and would still be reported as a filled form.
    const outcome = await fillPdfWithQuestions(t, 'C:/f.pdf', [], 'task-1');

    expect(fillPdf).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'failed', error: 'settings.voice.conversationPdfNothingToWrite' });
  });

  it('drops a value for a field the form does not have rather than writing it', async () => {
    scripted.set(questionIdFor('C:/f.pdf', 'txtSurname_1'), { status: 'answered', value: 'Lovelace' });
    scripted.set(questionIdFor('C:/f.pdf', 'txtGivenName'), { status: 'answered', value: 'Ada' });
    scripted.set(questionIdFor('C:/f.pdf', 'chkAgree'), { status: 'answered', value: 'no' });

    await fillPdfWithQuestions(t, 'C:/f.pdf', [{ field: 'maidenName', value: 'Byron' }], 'task-1');

    const names = fillPdf.mock.calls[0][0].answers.map((answer) => answer.name);
    expect(names).not.toContain('maidenName');
  });

  it('releases its questions when the run is over, however it ended', async () => {
    scripted.set(questionIdFor('C:/f.pdf', 'txtSurname_1'), { status: 'answered', value: 'a' });
    scripted.set(questionIdFor('C:/f.pdf', 'txtGivenName'), { status: 'answered', value: 'b' });
    scripted.set(questionIdFor('C:/f.pdf', 'chkAgree'), { status: 'answered', value: 'no' });
    await fillPdfWithQuestions(t, 'C:/f.pdf', [], 'task-done');

    readPdf.mockResolvedValue({ ok: true, fields: FORM, pages: 1 });
    fillPdf.mockResolvedValue({ ok: false, reason: 'write-failed' });
    await fillPdfWithQuestions(t, 'C:/f.pdf', [], 'task-failed');

    expect(endedTasks).toEqual(['task-done', 'task-failed']);
  });
});
