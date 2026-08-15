/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The way back from a document that was fetched and never appeared.
 *
 * Auto-opening is the intended route and it has failed on its own: the tool
 * saved the file, said so, and published the event on a channel this window
 * could not hear. The user was left with a document on disk, no viewer, and an
 * assistant reporting success — with nothing on screen to click.
 *
 * **The emitter here is the real one.** Mocking it is what let the original
 * fault through: the test mocked `ipcBridge.preview.open`, the same wrong
 * channel the code published on, so it agreed with the bug instead of
 * falsifying it. Subscribing to the actual module means a change back to any
 * other channel shows up as silence.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TraceRail from '@/renderer/pages/voice/hud/TraceRail';
import type { ConversationActivity } from '@/renderer/pages/voice/runtime/types';
import { emitter } from '@/renderer/utils/emitter';

const PDF = 'C:\\Users\\me\\AppData\\Local\\Temp\\fool\\found\\20_diffusion_models.pdf';

type PreviewOpen = { content: string; contentType: string; metadata?: { file_path?: string; title?: string } };

const heard: PreviewOpen[] = [];
const listen = (event: PreviewOpen): void => {
  heard.push(event);
};

afterEach(() => {
  emitter.off('preview.open', listen);
  heard.length = 0;
});

const activity = (over: Partial<ConversationActivity> = {}): ConversationActivity => ({
  id: 'call-1',
  label: 'app_find_document',
  detail: 'Opened 20_diffusion_models.pdf.',
  state: 'completed',
  ...over,
});

describe('TraceRail document recovery', () => {
  it('opens the document on the channel this window listens to', () => {
    emitter.on('preview.open', listen);
    render(<TraceRail activities={[activity({ document: { path: PDF, name: '20_diffusion_models.pdf' } })]} />);

    fireEvent.click(screen.getByTestId('voice-trace-open-document'));

    expect(heard).toHaveLength(1);
    // `file_path` is the field the PDF, Word and Excel viewers read off disk.
    // Without it the panel opens and renders the path as though it were the
    // document, which looks like a viewer and is not one.
    expect(heard[0].metadata?.file_path).toBe(PDF);
    expect(heard[0].contentType).toBe('pdf');
  });

  it('offers nothing to click when the step saved no file', () => {
    render(<TraceRail activities={[activity()]} />);

    expect(screen.queryByTestId('voice-trace-open-document')).toBeNull();
  });

  it('offers the document even on a step whose viewer never came up', () => {
    // The recovery case itself: the file is on disk and the panel did not
    // appear, so the row must still be clickable. A control that showed up
    // only after a successful open would be missing exactly when it is needed.
    render(
      <TraceRail
        activities={[
          activity({
            detail: 'Found 8 results.',
            document: { path: PDF, name: '20_diffusion_models.pdf' },
          }),
        ]}
      />
    );

    expect(screen.getByTestId('voice-trace-open-document')).toBeTruthy();
  });
});
