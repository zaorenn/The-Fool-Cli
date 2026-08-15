/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Nothing opens itself.
 *
 * A workspace watcher notices every `.docx`, `.xlsx` and `.pptx` that appears
 * while a conversation is running, and a second later a preview tab for it
 * opened over whatever the user was looking at. It was on by default, so a
 * long task that wrote four spreadsheets took the screen four times from
 * somebody who had asked for the spreadsheets and not for the tour.
 *
 * The capability is not the problem and it is kept — a document opening when
 * you asked for it opened is good. What is fixed is who decides. The
 * assistant opens documents when it is asked to, through `app_open_document`;
 * a file merely existing is not a request to be shown it.
 *
 * Pinned as a default rather than as behaviour because the default was the
 * bug: the same three-place `?? true` had to be found in three files, and a
 * fourth reader added later would have restored it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');

const source = (relative: string): string => readFileSync(path.join(ROOT, relative), 'utf8');

describe('the office preview default', () => {
  it('is off in the hook the watcher asks', () => {
    const hook = source('packages/desktop/src/renderer/hooks/system/useAutoPreviewOfficeFilesEnabled.ts');
    const fallback = hook.match(/return\s+enabled\s*\?\?\s*(true|false);/);

    expect(fallback?.[1], 'the office watcher still opens previews by default').toBe('false');
  });

  it('is off in the settings panel that reads the same key', () => {
    const panel = source(
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/SystemModalContent/index.tsx'
    );
    const fallback = panel.match(/get\('system\.autoPreviewOfficeFiles'\)\s*\?\?\s*(true|false)/);

    expect(fallback?.[1], 'the settings panel disagrees with the watcher').toBe('false');
  });

  it('does not seed the settings switch on before the configuration arrives', () => {
    // The panel holds the switch in local state and fills it in once the
    // configuration loads. That seed is a default too, and a switch that shows
    // "on" for a moment is a setting the user believes they chose.
    const panel = source(
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/SystemModalContent/index.tsx'
    );
    const seed = panel.match(/setAutoPreviewOfficeFiles\]\s*=\s*useState\((true|false)\)/);

    expect(seed?.[1]).toBe('false');
  });
});
