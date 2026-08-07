/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { layoutBrief } from '@/common/config/layoutBrief';
import { MOTION_EASINGS, MOTION_MOVES, MOTION_TARGETS } from '@/common/config/layoutMotions';
import { LAYOUT_TOKEN_KEYS, TOKEN_SPECS } from '@/common/config/layoutTokens';
import { LAYOUT_OPTION_VALUES, SURFACE_IDS, surfaceOptionKeys } from '@/common/config/surfaceLayouts';

/**
 * The instructions somebody hands to whichever AI they already use.
 *
 * Not everybody wants to turn nine controls themselves, and plenty of people can
 * describe a look far more easily than they can build one — "make it look like
 * an old oscilloscope" is a sentence, not a set of dropdown choices. So the app
 * hands out its own specification and takes back the result.
 *
 * The whole risk is drift. A brief written by hand describes the app as it was
 * on the day somebody wrote it, and the day an axis is added it starts telling
 * an external model to produce presets this app will reject — with no error
 * anywhere, because the brief is just text. So it is generated from the same
 * catalogues the editor and the sanitiser use, and these pin that: every axis,
 * every value, every dial and every movement word has to appear, whatever gets
 * added later.
 */

describe('layoutBrief', () => {
  const brief = layoutBrief();

  it('names every window that can be shaped', () => {
    for (const surface of SURFACE_IDS) expect(brief).toContain(surface);
  });

  it('lists every axis a window answers, and every value it may take', () => {
    for (const surface of SURFACE_IDS) {
      for (const key of surfaceOptionKeys(surface)) {
        expect(brief).toContain(key);
        for (const value of LAYOUT_OPTION_VALUES[key] as readonly string[]) {
          expect(brief).toContain(value);
        }
      }
    }
  });

  it('gives every dial its real range, so a model cannot invent one', () => {
    for (const key of LAYOUT_TOKEN_KEYS) {
      expect(brief).toContain(key);
      expect(brief).toContain(String(TOKEN_SPECS[key].min));
      expect(brief).toContain(String(TOKEN_SPECS[key].max));
    }
  });

  it('teaches the whole movement vocabulary', () => {
    for (const target of MOTION_TARGETS) expect(brief).toContain(target);
    for (const move of MOTION_MOVES) expect(brief).toContain(move);
    for (const easing of MOTION_EASINGS) expect(brief).toContain(easing);
  });

  it('carries a worked example that this app would actually accept', () => {
    // The example is extracted and read back through the real importer in
    // layoutImport.test.ts. Here: it is present and it is JSON.
    const fenced = brief.match(/```json\n([\s\S]*?)\n```/);
    expect(fenced).not.toBeNull();
    expect(() => JSON.parse(fenced?.[1] ?? '')).not.toThrow();
  });

  it('asks for JSON and nothing else, because the answer is pasted into a file', () => {
    expect(brief.toLowerCase()).toContain('json');
    expect(brief.toLowerCase()).toMatch(/only|nothing else|no explanation/);
  });

  it('is one block a person can select and copy without editing it', () => {
    expect(brief.length).toBeGreaterThan(600);
    expect(brief).not.toContain('undefined');
    expect(brief).not.toContain('[object Object]');
  });
});
