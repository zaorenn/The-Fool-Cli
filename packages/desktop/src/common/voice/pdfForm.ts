/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Filling in a form by being asked for each value out loud.
 *
 * A PDF form is a list of named fields, and the names are written for whoever
 * built the form: `txtSurname_1`, `CB3`, `Field.0.2`. Read out as they are they
 * mean nothing, so the conversation has to turn them into something a person
 * recognises before it can ask anything — and it has to map the answer back
 * without inventing a field that does not exist.
 *
 * This is the part with no library and no window in it: naming, matching and
 * checking. Reading the actual document and writing the filled copy live in the
 * main process, where `pdf-lib` is; keeping the decisions here means they can
 * be tested without a PDF and, more importantly, that the rule about never
 * writing to a field the form did not declare is enforced in one readable place.
 */

/** What kind of thing a field will accept, as far as the conversation cares. */
export type PdfFieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown';

export type PdfField = {
  /** The name inside the document. Never read aloud. */
  name: string;
  kind: PdfFieldKind;
  /** For a radio group or dropdown, what it will accept. */
  options?: readonly string[];
  /** Whatever is already in it, so an answered field is not asked again. */
  value?: string;
  /**
   * Whether the document itself says this one has to be filled.
   *
   * The line between interrupting the user and guessing. A required field with
   * no known value is worth stopping the whole task to ask about; an optional
   * one is not, and a form with forty optional boxes would otherwise become
   * forty questions nobody agreed to answer.
   */
  required?: boolean;
};

/**
 * Fields that must be asked about before the form can be called filled.
 *
 * Required, and nothing known for them. Optional blanks are left blank and
 * reported — which is the honest outcome, and the one the user can act on.
 */
export const fieldsToAsk = (fields: readonly PdfField[]): PdfField[] =>
  fields.filter((field) => field.required === true && (field.value ?? '').trim().length === 0);

/** One answer, ready to be written. */
export type PdfAnswer = { name: string; value: string };

/**
 * What came back from opening a document.
 *
 * Here rather than beside `pdf-lib` in the main process because the IPC bridge
 * is shared, and a renderer naming its own return type would otherwise drag
 * `node:fs` across the process boundary to get at it.
 *
 * A document with no form fields is reported as such rather than as an empty
 * form: "there is nothing to fill in" and "I could not find the fields" are
 * different answers, and a model told the first will say the document is blank.
 */
export type PdfReadResult =
  | { ok: true; fields: PdfField[]; pages: number }
  | { ok: false; reason: 'unreadable' | 'not-a-form'; detail?: string };

/**
 * What came back from writing a filled copy.
 *
 * `skipped` is not decoration. It is the fields that were asked for and did not
 * take, and it exists so the assistant can name them rather than report a form
 * as complete while part of it is still empty.
 */
export type PdfFillResult =
  | { ok: true; writtenTo: string; filled: string[]; skipped: string[] }
  | { ok: false; reason: 'unreadable' | 'write-failed'; detail?: string };

/**
 * Narrowing helpers, because `if (!result.ok)` does not narrow in this project.
 *
 * `strictNullChecks` is off, and without it a `true`/`false` literal is not a
 * discriminant TypeScript will follow — reading `.reason` off the failure
 * branch is an error even after the check that proves it is the failure branch.
 * New unions here discriminate on a string for that reason (see
 * `QuestionOutcome`); these two are already public and already tested, so they
 * keep their shape and get a guard apiece instead.
 */
export const pdfReadFailed = (result: PdfReadResult): result is Extract<PdfReadResult, { ok: false }> =>
  result.ok === false;

export const pdfFillFailed = (result: PdfFillResult): result is Extract<PdfFillResult, { ok: false }> =>
  result.ok === false;

/**
 * A field name turned into a question a person can answer.
 *
 * Machine names are punctuated with the form builder's habits — underscores,
 * dots, digits, a `txt`/`chk`/`cb` prefix announcing the widget type — and all
 * of it is noise to the person being asked. Stripped, split on case changes,
 * and given back as words.
 *
 * A name that survives as nothing readable is returned empty rather than as a
 * mangled fragment: the caller then asks about it by position ("the third box
 * on page two"), which is at least true.
 */
export const readableFieldName = (name: string): string => {
  const withoutWidget = name.replace(/^(txt|text|chk|check|cb|rb|radio|dd|drop|fld|field)[._-]?/i, '');
  const words = withoutWidget
    // `SurnameOfApplicant` → `Surname Of Applicant`, before separators are lost.
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[._\-\s]+/)
    // Trailing indices are the form's bookkeeping, not part of the question.
    .filter((word) => word.length > 0 && !/^\d+$/.test(word))
    // Lowercased before the sentence is capitalised, because this is going to
    // be *said*: "Date Of Birth" reads as three separate labels out loud, where
    // "Date of birth" is a question.
    .map((word) => word.toLowerCase())
    .join(' ')
    .trim();

  return words.length === 0 ? '' : words.charAt(0).toUpperCase() + words.slice(1);
};

/** Fields still worth asking about: everything the form has and nobody has answered. */
export const unansweredFields = (fields: readonly PdfField[]): PdfField[] =>
  fields.filter((field) => (field.value ?? '').trim().length === 0);

/**
 * Whether a value is one this field will actually take.
 *
 * A checkbox that is handed "maybe", or a dropdown handed an option it does not
 * have, is a write that either fails inside the library or silently produces a
 * document that looks filled and is not. Both are worse than asking again.
 */
export const acceptsValue = (field: PdfField, value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  if (field.kind === 'checkbox') return /^(yes|no|true|false|on|off|evet|hayır|hayir)$/i.test(trimmed);
  if (field.kind === 'radio' || field.kind === 'dropdown') {
    return (field.options ?? []).some((option) => option.toLowerCase() === trimmed.toLowerCase());
  }
  return true;
};

/** Checkboxes are written as a boolean whatever the user said to mean it. */
export const asCheckbox = (value: string): boolean => /^(yes|true|on|evet)$/i.test(value.trim());

/**
 * Answers narrowed to those this form can take, and what was rejected.
 *
 * Deliberately not "repair and continue". A form filled with a value the field
 * did not accept is the PDF equivalent of saying the song is playing: it looks
 * finished, it is handed in, and the mistake surfaces somewhere the user cannot
 * see it. Rejections come back so the conversation can ask again, naming the
 * field in words rather than by its machine name.
 */
export const planAnswers = (
  fields: readonly PdfField[],
  answers: readonly PdfAnswer[]
): { write: PdfAnswer[]; rejected: { name: string; readable: string; reason: 'unknown-field' | 'bad-value' }[] } => {
  const byName = new Map(fields.map((field) => [field.name, field]));
  const write: PdfAnswer[] = [];
  const rejected: { name: string; readable: string; reason: 'unknown-field' | 'bad-value' }[] = [];

  for (const answer of answers) {
    const field = byName.get(answer.name);
    if (!field) {
      // The model invented a field. Writing it would do nothing at all, and
      // reporting success afterwards would be a lie of exactly the shape this
      // codebase has spent a release stamping out.
      rejected.push({ name: answer.name, readable: readableFieldName(answer.name), reason: 'unknown-field' });
      continue;
    }
    if (!acceptsValue(field, answer.value)) {
      rejected.push({ name: answer.name, readable: readableFieldName(answer.name), reason: 'bad-value' });
      continue;
    }
    write.push({ name: field.name, value: answer.value.trim() });
  }

  return { write, rejected };
};
