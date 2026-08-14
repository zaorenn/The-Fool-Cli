/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  findRun,
  freeBandBelow,
  freeSpaceRightOf,
  readPageText,
  runBox,
  type PageText,
} from '@process/pdf/pdfLayout';

/**
 * Real documents, not synthesised ones. Neither carries a single AcroForm
 * field, which is the whole reason this module exists: the fill path that
 * shipped only works on fillable PDFs, and these are what people actually have.
 */
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'pdf', name)));

describe('readPageText', () => {
  let form: PageText;
  let questions: PageText;

  beforeAll(async () => {
    [form] = await readPageText(fixture('staj-formu.pdf'));
    [questions] = await readPageText(fixture('matematik-sorular.pdf'));
  });

  it('reports the page geometry', () => {
    expect(Math.round(form.width)).toBe(595);
    expect(Math.round(form.height)).toBe(842);
  });

  it('reads the labels of the internship form', () => {
    const labels = form.runs.map((run) => run.text.trim());

    expect(labels).toContain('Adiniz Soyadiniz:');
    expect(labels).toContain('TC Kimlik No:');
    expect(labels).toContain('Fakulte / Bolum:');
  });

  it('drops runs that carry no visible characters', () => {
    expect(form.runs.every((run) => run.text.trim() !== '')).toBe(true);
  });

  it('places every run inside the page', () => {
    for (const run of form.runs) {
      expect(run.x).toBeGreaterThanOrEqual(0);
      expect(run.y).toBeGreaterThanOrEqual(0);
      expect(run.x + run.width).toBeLessThanOrEqual(form.width);
    }
  });

  it('reads each question of the exam paper', () => {
    const headers = questions.runs.filter((run) => /^Soru \d/.test(run.text.trim()));

    expect(headers).toHaveLength(4);
  });
});

describe('freeSpaceRightOf', () => {
  let form: PageText;

  beforeAll(async () => {
    [form] = await readPageText(fixture('staj-formu.pdf'));
  });

  it('offers the rest of the line beside a label', () => {
    const label = findRun(form, 'Adiniz Soyadiniz:');
    const space = freeSpaceRightOf(form, label!);

    expect(space.x).toBeGreaterThan(label!.x);
    expect(space.width).toBeGreaterThan(200);
  });

  it('stops at the neighbour when a line carries two labels', () => {
    // "Ogrencinin Imzasi:" sits at x=50 and "Tarih:" at x=320 on one baseline.
    const signature = findRun(form, 'Ogrencinin Imzasi:');
    const date = findRun(form, 'Tarih:');
    const space = freeSpaceRightOf(form, signature!);

    expect(space.x + space.width).toBeLessThanOrEqual(date!.x);
  });

  it('never overlaps the label it sits beside', () => {
    const label = findRun(form, 'TC Kimlik No:');
    const space = freeSpaceRightOf(form, label!);

    expect(boxesOverlap(space, runBox(label!))).toBe(false);
  });
});

describe('freeBandBelow', () => {
  let questions: PageText;

  beforeAll(async () => {
    [questions] = await readPageText(fixture('matematik-sorular.pdf'));
  });

  it('stops at the next question rather than running over it', () => {
    const second = findRun(questions, /^Soru 2/);
    const firstBody = questions.runs.find((run) => run.text.includes('eyer (saddle)'));
    const band = freeBandBelow(questions, firstBody!);

    expect(band.y).toBeGreaterThanOrEqual(runBox(second!).y + runBox(second!).height - 0.01);
  });

  it('reports the gap between questions as too small for a worked solution', () => {
    const firstBody = questions.runs.find((run) => run.text.includes('eyer (saddle)'));
    const band = freeBandBelow(questions, firstBody!);

    // Roughly three lines at 12pt. This is the measurement that decides whether
    // an answer can go under its question at all, and for this paper it cannot.
    expect(band.height).toBeLessThan(60);
  });

  it('gives the last question the rest of the page', () => {
    const lastBody = questions.runs.find((run) => run.text.includes('Iki katli integrali'));
    const band = freeBandBelow(questions, lastBody!);

    expect(band.height).toBeGreaterThan(400);
  });

  it('never overlaps any existing run', () => {
    const firstBody = questions.runs.find((run) => run.text.includes('eyer (saddle)'));
    const band = freeBandBelow(questions, firstBody!);

    for (const run of questions.runs) {
      expect(boxesOverlap(band, runBox(run))).toBe(false);
    }
  });
});
