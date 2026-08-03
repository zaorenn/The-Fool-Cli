/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every element the notch renderer reaches for has to exist in the notch.
 *
 * The renderer looks its elements up once at module scope and casts the result
 * to an element type — a cast that lies, because `getElementById` returns null
 * for anything absent. Nothing then fails until the first render, and in a
 * window with no console open that is a notch that silently stops working.
 *
 * The DOM tests build their own fixture rather than loading the real file, so
 * markup and fixture can drift apart; that is exactly how an added element went
 * missing and took eight tests down with it. This checks the renderer against
 * the shipped HTML instead of against a copy of it.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const rendererPath = path.join(repoRoot, 'packages/desktop/src/renderer/voice/foolsControlRenderer.ts');
const markupPath = path.join(repoRoot, 'packages/desktop/src/renderer/voice/foolsControl.html');

const read = (file: string): string => readFileSync(file, 'utf8');

/** The ids the renderer looks up, in source order. */
const idsUsedByRenderer = (source: string): string[] =>
  [...source.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(([, id]) => id);

/** The ids the markup actually declares. */
const idsDeclaredInMarkup = (html: string): Set<string> =>
  new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(([, id]) => id));

describe("Fool's Control markup", () => {
  it('declares every element the renderer looks up', () => {
    const used = idsUsedByRenderer(read(rendererPath));
    const declared = idsDeclaredInMarkup(read(markupPath));

    // Guards the guard: a renderer that looked nothing up would pass vacuously.
    expect(used.length).toBeGreaterThan(5);

    const missing = used.filter((id) => !declared.has(id));
    expect(missing).toEqual([]);
  });

  it('keeps the DOM test fixture in step with the shipped markup', () => {
    const used = idsUsedByRenderer(read(rendererPath));
    const fixture = idsDeclaredInMarkup(read(path.join(__dirname, 'foolsControl.dom.test.ts')));

    const missing = used.filter((id) => !fixture.has(id));
    expect(missing).toEqual([]);
  });
});
