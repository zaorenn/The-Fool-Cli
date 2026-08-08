/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  acceptsValue,
  asCheckbox,
  planAnswers,
  readableFieldName,
  unansweredFields,
  type PdfField,
} from '@/common/voice/pdfForm';

describe('readableFieldName', () => {
  it('turns a form builder’s name into something you can ask about', () => {
    expect(readableFieldName('txtSurname_1')).toBe('Surname');
    expect(readableFieldName('applicant_first_name')).toBe('Applicant first name');
    expect(readableFieldName('DateOfBirth')).toBe('Date of birth');
  });

  it('drops the widget prefix and the bookkeeping index', () => {
    expect(readableFieldName('chk_agree_2')).toBe('Agree');
    expect(readableFieldName('Field.0.2')).toBe('');
  });

  it('gives back nothing rather than a mangled fragment', () => {
    // The caller then asks by position — "the third box on page two" — which is
    // at least true, where a half-word would be confidently wrong.
    expect(readableFieldName('_1')).toBe('');
    expect(readableFieldName('')).toBe('');
  });
});

describe('unansweredFields', () => {
  it('leaves out what the form already carries', () => {
    const fields: PdfField[] = [
      { name: 'a', kind: 'text', value: 'already here' },
      { name: 'b', kind: 'text' },
      { name: 'c', kind: 'text', value: '   ' },
    ];

    expect(unansweredFields(fields).map((field) => field.name)).toEqual(['b', 'c']);
  });
});

describe('acceptsValue', () => {
  const dropdown: PdfField = { name: 'country', kind: 'dropdown', options: ['Türkiye', 'Germany'] };

  it('takes any non-empty text for a text field', () => {
    expect(acceptsValue({ name: 'x', kind: 'text' }, 'Serhan')).toBe(true);
    expect(acceptsValue({ name: 'x', kind: 'text' }, '   ')).toBe(false);
  });

  it('only takes something a checkbox can mean', () => {
    expect(acceptsValue({ name: 'x', kind: 'checkbox' }, 'evet')).toBe(true);
    expect(acceptsValue({ name: 'x', kind: 'checkbox' }, 'maybe')).toBe(false);
  });

  it('holds a dropdown to the options it actually has', () => {
    expect(acceptsValue(dropdown, 'germany')).toBe(true);
    expect(acceptsValue(dropdown, 'Fransa')).toBe(false);
  });
});

describe('asCheckbox', () => {
  it('reads a spoken yes in either language', () => {
    expect(asCheckbox('evet')).toBe(true);
    expect(asCheckbox('Yes')).toBe(true);
    expect(asCheckbox('hayir')).toBe(false);
  });
});

describe('planAnswers', () => {
  const fields: PdfField[] = [
    { name: 'txtName', kind: 'text' },
    { name: 'chkAgree', kind: 'checkbox' },
    { name: 'ddCountry', kind: 'dropdown', options: ['Germany'] },
  ];

  it('passes through what the form will take', () => {
    const { write, rejected } = planAnswers(fields, [
      { name: 'txtName', value: '  Serhan  ' },
      { name: 'chkAgree', value: 'evet' },
    ]);

    expect(write).toEqual([
      { name: 'txtName', value: 'Serhan' },
      { name: 'chkAgree', value: 'evet' },
    ]);
    expect(rejected).toEqual([]);
  });

  it('refuses a field the form never declared', () => {
    // The model inventing a field is the PDF version of saying the song is
    // playing: the write does nothing, and reporting success afterwards is a
    // lie the user cannot see.
    const { write, rejected } = planAnswers(fields, [{ name: 'txtMiddleName', value: 'Ali' }]);

    expect(write).toEqual([]);
    expect(rejected).toEqual([{ name: 'txtMiddleName', readable: 'Middle name', reason: 'unknown-field' }]);
  });

  it('refuses a value the field cannot hold, and names it in words', () => {
    const { write, rejected } = planAnswers(fields, [{ name: 'ddCountry', value: 'Fransa' }]);

    expect(write).toEqual([]);
    expect(rejected).toEqual([{ name: 'ddCountry', readable: 'Country', reason: 'bad-value' }]);
  });

  it('writes the good answers even when one is refused', () => {
    // A form half-filled is progress; throwing away six correct answers because
    // the seventh was wrong would make the user say all of them again.
    const { write, rejected } = planAnswers(fields, [
      { name: 'txtName', value: 'Serhan' },
      { name: 'ddCountry', value: 'Fransa' },
    ]);

    expect(write.map((answer) => answer.name)).toEqual(['txtName']);
    expect(rejected.map((entry) => entry.name)).toEqual(['ddCountry']);
  });
});
