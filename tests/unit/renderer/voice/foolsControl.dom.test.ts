/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VOICE_STAGE_OFF, type VoiceStageEvent } from '@/common/types/voiceStage';

/** What the notch told the main process about where it drew itself. */
const reportedBounds: { x: number; y: number; width: number; height: number }[] = [];

/** Pushes the main process's verdict about the cursor, as the preload would. */
let pushPointer: ((over: boolean) => void) | undefined;

/**
 * Fool's Control, the notch at the top of the screen.
 *
 * Rendered without React or i18n on purpose, so it is exercised the way it runs:
 * a real document, the real module, and stage events pushed through the same
 * callback the preload hands it.
 */
const mountNotch = async (): Promise<(event: VoiceStageEvent) => void> => {
  reportedBounds.length = 0;
  pushPointer = undefined;
  // jsdom has no layout and so no observer for it. The notch reports on every
  // layout change, which in a test is only ever the one it is given.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
  );
  document.body.innerHTML = `
    <div id="notch">
      <div id="head">
        <span id="dot"></span>
        <canvas id="wave"></canvas>
        <span id="stage"></span>
        <span id="hint"></span>
      </div>
      <div id="body">
        <div id="transcript" data-placeholder=""></div>
        <div id="reply"></div>
        <div id="activity"></div>
        <div id="ask">
          <div id="ask-title"></div>
          <div id="ask-options"></div>
          <div id="ask-hint"></div>
        </div>
      </div>
    </div>`;

  let handler: ((event: VoiceStageEvent) => void) | undefined;
  vi.stubGlobal('requestAnimationFrame', () => 0);
  Object.defineProperty(window, 'foolsControlAPI', {
    configurable: true,
    value: {
      onStage: (callback: (event: VoiceStageEvent) => void) => {
        handler = callback;
        return () => undefined;
      },
      onPointer: (callback: (over: boolean) => void) => {
        pushPointer = callback;
        return () => undefined;
      },
      reportBounds: (bounds: { x: number; y: number; width: number; height: number }) => {
        reportedBounds.push(bounds);
      },
    },
  });

  vi.resetModules();
  await import('@renderer/voice/foolsControlRenderer');
  if (!handler) throw new Error('the notch never subscribed');
  return handler;
};

const stage = (patch: Partial<VoiceStageEvent> = {}): VoiceStageEvent => ({
  ...VOICE_STAGE_OFF,
  stage: 'listening',
  accent: '#c4123f',
  ...patch,
});

describe("Fool's Control", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays a pill while it is only waiting for the wake phrase', async () => {
    const push = await mountNotch();

    push(stage({ stageLabel: 'Listening' }));

    const notch = document.getElementById('notch') as HTMLDivElement;
    expect(notch.classList.contains('shown')).toBe(true);
    // Nothing has been said yet — a wide notch open over the user's screen for
    // no reason is worse than a small one.
    expect(notch.classList.contains('wide')).toBe(false);
  });

  it('opens once there is a sentence to read', async () => {
    const push = await mountNotch();

    push(stage({ stage: 'processing', transcript: 'open my notes' }));

    expect((document.getElementById('notch') as HTMLDivElement).classList.contains('wide')).toBe(true);
    expect(document.getElementById('transcript')?.textContent).toBe('open my notes');
  });

  /**
   * The half of this surface that behaves like a small chat window: what the
   * agent is doing about what was said, while it does it.
   */
  it('opens for the agent’s work even before anything was transcribed', async () => {
    const push = await mountNotch();

    push(
      stage({
        stage: 'generating',
        activity: [
          { text: 'Creating a note', done: true },
          { text: 'Writing to notes.txt', done: false },
        ],
      })
    );

    const notch = document.getElementById('notch') as HTMLDivElement;
    expect(notch.classList.contains('wide')).toBe(true);

    const rows = [...document.querySelectorAll('#activity .act')];
    expect(rows.map((row) => row.textContent)).toEqual(['Creating a note', 'Writing to notes.txt']);
    // A finished step dims rather than disappearing, so the turn reads as a list
    // of what happened and not just what is happening.
    expect(rows[0].className).toContain('done');
    expect(rows[1].className).not.toContain('done');
  });

  /**
   * The list is replaced from the event, never appended to. A step that was
   * abandoned upstream has to disappear here too, which an append-only log
   * could not do.
   */
  it('replaces the activity list rather than growing it', async () => {
    const push = await mountNotch();

    push(stage({ activity: [{ text: 'Reading the file', done: false }] }));
    push(stage({ activity: [{ text: 'Writing the file', done: false }] }));

    const rows = [...document.querySelectorAll('#activity .act')];
    expect(rows.map((row) => row.textContent)).toEqual(['Writing the file']);
  });

  // The notice is for work the user would otherwise read as a hang — a local
  // model taking half a minute to load.
  it('lets a notice take the hint’s place', async () => {
    const push = await mountNotch();

    push(stage({ hint: 'say wake up fool', notice: 'waking the model' }));

    expect(document.getElementById('hint')?.textContent).toBe('waking the model');
  });

  /**
   * Both halves of the turn, on one surface: the question and the answer. The
   * answer is the *spoken* text, so a long reply shows the summary that is
   * actually being read rather than paragraphs nobody will hear.
   */
  it('shows the assistant’s reply alongside what was asked', async () => {
    const push = await mountNotch();

    push(stage({ stage: 'speaking', transcript: 'what is the build status', reply: 'All tests pass.' }));

    expect(document.getElementById('transcript')?.textContent).toBe('what is the build status');
    expect(document.getElementById('reply')?.textContent).toBe('All tests pass.');
    expect((document.getElementById('notch') as HTMLDivElement).classList.contains('wide')).toBe(true);
  });

  // A reply with nothing said before it — read-aloud pressed on a message —
  // still deserves the open notch.
  it('opens for a reply even when nothing was transcribed', async () => {
    const push = await mountNotch();

    push(stage({ stage: 'speaking', reply: 'All tests pass.' }));

    expect((document.getElementById('notch') as HTMLDivElement).classList.contains('wide')).toBe(true);
  });

  it('retracts into the edge when the turn is over', async () => {
    const push = await mountNotch();

    push(stage({ transcript: 'open my notes' }));
    push({ ...VOICE_STAGE_OFF });

    const notch = document.getElementById('notch') as HTMLDivElement;
    expect(notch.classList.contains('shown')).toBe(false);
  });

  /**
   * Getting out of the way of the cursor.
   *
   * This had no test at all, and it had two faults that a test would have
   * caught. The listener was on the *window* — a fixed 680x280 box sized for
   * the widest state the notch ever reaches — so the pill faded whenever the
   * cursor entered that whole region, nowhere near the 190 pixels actually
   * drawn. And the forwarded mouse stream stops when the pointer leaves, with
   * no closing event to match the opening one, so a faded notch could stay
   * faded for the rest of the session.
   *
   * Both are gone because the decision is no longer made here: the main process
   * reads the system cursor against the rectangle this window reports.
   */
  describe('under the pointer', () => {
    it('fades only when the main process says the cursor is over it', async () => {
      const push = await mountNotch();
      push(stage({ transcript: 'open my notes' }));
      const notch = document.getElementById('notch') as HTMLDivElement;

      expect(notch.classList.contains('under-pointer')).toBe(false);

      pushPointer?.(true);
      expect(notch.classList.contains('under-pointer')).toBe(true);

      pushPointer?.(false);
      expect(notch.classList.contains('under-pointer')).toBe(false);
    });

    /**
     * The old implementation faded on any mouse event anywhere in the window,
     * which is most of the top of the screen. Nothing in this window listens to
     * the mouse any more, so moving over it changes nothing on its own.
     */
    it('ignores mouse events in the window, which is not the notch', async () => {
      const push = await mountNotch();
      push(stage({ transcript: 'open my notes' }));
      const notch = document.getElementById('notch') as HTMLDivElement;

      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 640, clientY: 240 }));

      expect(notch.classList.contains('under-pointer')).toBe(false);
    });

    it('tells the main process where it drew itself', async () => {
      const push = await mountNotch();
      push(stage({ transcript: 'open my notes' }));

      window.dispatchEvent(new Event('resize'));

      expect(reportedBounds.length).toBeGreaterThan(0);
      expect(reportedBounds.at(-1)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
  });
});
