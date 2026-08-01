/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';

/**
 * The microphone is deaf while the agent works, and hears again the moment there
 * is an answer to interrupt.
 *
 * Without the hold, everything said or overheard during a two-minute run queues
 * up as the next command; without the release, barge-in stops working.
 */

const transcribeInvoke = vi.fn();
const synthesizeInvoke = vi.fn();
const healthInvoke = vi.fn();
const catalogInvoke = vi.fn();
const play = vi.fn().mockResolvedValue(undefined);
const playbackStop = vi.fn();

const streamHandlers: Array<(message: unknown) => void> = [];
const emitStream = (message: unknown): void => streamHandlers.forEach((handler) => handler(message));

let frameHandler: ((frame: { rms: number }) => void) | null = null;
let vadEvents: (string | null)[] = [];
const beginUtterance = vi.fn();
const takeUtteranceWav = vi.fn();

const audio = {
  encoding: 'base64' as const,
  mimeType: 'audio/wav' as const,
  sampleRateHz: 16000 as const,
  channels: 1 as const,
  sampleFormat: 'pcm16le' as const,
  byteLength: 4,
  dataBase64: 'AAAA',
};

vi.mock('@/common', () => ({
  ipcBridge: {
    foolVoice: {
      transcribe: { invoke: (request: unknown) => transcribeInvoke(request) },
      synthesize: { invoke: (request: unknown) => synthesizeInvoke(request) },
      health: { invoke: (request: unknown) => healthInvoke(request) },
      catalog: { invoke: (request: unknown) => catalogInvoke(request) },
      stage: { emit: () => undefined },
    },
    conversation: {
      responseStream: {
        on: (handler: (message: unknown) => void) => {
          streamHandlers.push(handler);
          return () => {
            const index = streamHandlers.indexOf(handler);
            if (index >= 0) streamHandlers.splice(index, 1);
          };
        },
      },
    },
  },
}));

vi.mock('@renderer/services/voice/MicrophoneCapture', () => ({
  MicrophoneCapture: class {
    public start = () => Promise.resolve();
    public onFrame = (callback: (frame: { rms: number }) => void) => {
      frameHandler = callback;
    };
    public beginUtterance = beginUtterance;
    public takeUtteranceWav = takeUtteranceWav;
    public stop = () => undefined;
  },
}));

vi.mock('@renderer/services/voice/AdaptiveVad', () => ({
  AdaptiveVad: class {
    public push = () => vadEvents.shift() ?? null;
    public reset = () => undefined;
    public isSpeaking = () => false;
  },
}));

vi.mock('@renderer/services/voice/AudioPlaybackService', () => ({
  AudioPlaybackService: class {
    private generation = 0;
    public play = play;
    public setOutputDevice = () => undefined;
    public playWakeChime = () => Promise.resolve();
    // A stop invalidates the token the answer is being spoken under, so the
    // clips still queued behind it are dropped.
    public stop = (): void => {
      this.generation += 1;
      playbackStop();
    };
    public currentGeneration = (): number => this.generation;
    public isCurrent = (generation: number): boolean => this.generation === generation;
  },
}));

// Speech is the model's own text now: sanitised and spoken, with no narrator
// adding sentences about the run and no fallback phrase replacing it.
vi.mock('@renderer/services/voice/narration/englishSummary', () => ({
  summarizeForSpeech: (raw: string) => Promise.resolve({ text: raw, source: 'off' }),
}));

const { useFoolVoiceSession, VOICE_REPLY_EVENT, VOICE_TURN_EVENT } =
  await import('@renderer/hooks/voice/useFoolVoiceSession');

let session: ReturnType<typeof useFoolVoiceSession> | null = null;

const Harness: React.FC<{ settings: FoolVoiceSettings }> = ({ settings }) => {
  session = useFoolVoiceSession(settings);
  return null;
};

/** Drives one complete utterance through the frame callback. */
const speakOnce = async (): Promise<void> => {
  vadEvents = ['utterance-ended'];
  takeUtteranceWav.mockReturnValueOnce(audio);
  await act(async () => {
    frameHandler?.({ rms: 0.4 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useFoolVoiceSession — the microphone hold', () => {
  beforeEach(() => {
    frameHandler = null;
    vadEvents = [];
    streamHandlers.length = 0;
    transcribeInvoke.mockReset();
    synthesizeInvoke.mockReset();
    beginUtterance.mockClear();
    takeUtteranceWav.mockReset();
    play.mockClear();
    playbackStop.mockClear();
    healthInvoke.mockResolvedValue({ ok: true, data: { status: 'ready' } });
    // A voice has to be installed for there to be an answer to interrupt.
    catalogInvoke.mockResolvedValue({
      ok: true,
      data: {
        models: [
          {
            id: 'tts-piper-en-libritts-r',
            providerId: 'local-sherpa',
            role: 'text-to-speech',
            state: { status: 'ready' },
            profileIds: ['libritts-p0'],
          },
        ],
        profiles: [],
      },
    });
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'run the tests' } });
    synthesizeInvoke.mockResolvedValue({ ok: true, data: { audio } });
  });

  const start = async (settings: FoolVoiceSettings = DEFAULT_FOOL_VOICE_SETTINGS): Promise<void> => {
    render(<Harness settings={settings} />);
    await act(async () => {
      await session?.start();
    });
  };

  it('submits what was said and then stops listening', async () => {
    await start();
    const submitted: string[] = [];
    const onTurn = (event: Event) => submitted.push((event as CustomEvent<{ text: string }>).detail.text);
    window.addEventListener(VOICE_TURN_EVENT, onTurn);

    await speakOnce();
    expect(submitted).toEqual(['run the tests']);

    // A second utterance while the agent works must not become a second command.
    transcribeInvoke.mockClear();
    await speakOnce();
    expect(transcribeInvoke).not.toHaveBeenCalled();
    expect(submitted).toEqual(['run the tests']);

    window.removeEventListener(VOICE_TURN_EVENT, onTurn);
  });

  it('listens again once there is an answer to interrupt', async () => {
    await start();
    await speakOnce();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(VOICE_REPLY_EVENT, { detail: { answer: 'The tests pass.' } }));
      // Summary, catalog, synthesis and playback each take a turn of the queue.
      for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    });

    expect(play).toHaveBeenCalled();

    transcribeInvoke.mockClear();
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'stop, do the other thing' } });
    await speakOnce();

    expect(transcribeInvoke).toHaveBeenCalled();
  });

  it('lets go of the microphone when the session is stopped mid-run', async () => {
    await start();
    await speakOnce();

    act(() => session?.stop());

    // Nothing is captured after a stop, held or not.
    transcribeInvoke.mockClear();
    await speakOnce();
    expect(transcribeInvoke).not.toHaveBeenCalled();
  });
});

/**
 * Streaming speech for the hands-free session — same idea as the typed-turn
 * auto-read-aloud feature (start speaking on the first complete sentence
 * rather than waiting for the whole reply), but only when the English
 * summary is switched off: with it on, the reply has to be translated and
 * shortened first, so there is nothing to speak until it is whole.
 */
describe('useFoolVoiceSession — streaming speech', () => {
  const NO_SUMMARY: FoolVoiceSettings = {
    ...DEFAULT_FOOL_VOICE_SETTINGS,
    summary: { ...DEFAULT_FOOL_VOICE_SETTINGS.summary, translateToEnglish: false },
  };

  beforeEach(() => {
    frameHandler = null;
    vadEvents = [];
    streamHandlers.length = 0;
    transcribeInvoke.mockReset();
    synthesizeInvoke.mockReset();
    beginUtterance.mockClear();
    takeUtteranceWav.mockReset();
    play.mockClear();
    play.mockResolvedValue(undefined);
    playbackStop.mockClear();
    healthInvoke.mockResolvedValue({ ok: true, data: { status: 'ready' } });
    catalogInvoke.mockResolvedValue({
      ok: true,
      data: {
        models: [
          {
            id: 'tts-piper-en-libritts-r',
            providerId: 'local-sherpa',
            role: 'text-to-speech',
            state: { status: 'ready' },
            profileIds: ['libritts-p0'],
          },
        ],
        profiles: [],
      },
    });
    transcribeInvoke.mockResolvedValue({ ok: true, data: { text: 'run the tests' } });
    synthesizeInvoke.mockResolvedValue({ ok: true, data: { audio } });
  });

  const start = async (settings: FoolVoiceSettings = DEFAULT_FOOL_VOICE_SETTINGS): Promise<void> => {
    render(<Harness settings={settings} />);
    await act(async () => {
      await session?.start();
    });
  };

  it('starts speaking before the reply finishes, when the English summary is switched off', async () => {
    await start(NO_SUMMARY);
    await speakOnce();

    await act(async () => {
      emitStream({
        type: 'text',
        conversation_id: 'c1',
        turn_id: 't1',
        msg_id: 'm1',
        data: 'First sentence. Still typing',
      });
      for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
    });

    // No `finish` message has been sent — speech did not wait for one.
    expect(synthesizeInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ text: 'First sentence.' }) })
    );
  });

  it('does not speak until the reply finishes, when the English summary stays on', async () => {
    await start();
    await speakOnce();

    await act(async () => {
      emitStream({
        type: 'text',
        conversation_id: 'c1',
        turn_id: 't1',
        msg_id: 'm1',
        data: 'First sentence. Still typing',
      });
      for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
    });
    expect(synthesizeInvoke).not.toHaveBeenCalled();

    await act(async () => {
      emitStream({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
      for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    });
    expect(synthesizeInvoke).toHaveBeenCalled();
  });

  it('appends a short evidence statement and reopens the microphone once the reply and its run are both done', async () => {
    await start(NO_SUMMARY);
    await speakOnce();

    await act(async () => {
      // Trailing space after the period, so the sentence is confirmed by real
      // punctuation rather than by "nothing else has arrived yet" — the
      // latter is deliberately held back one push longer (see
      // `incrementalSpeechCollector.test.ts`'s replace-safety cases), which
      // would make this assertion about the wrong thing.
      emitStream({ type: 'text', conversation_id: 'c1', turn_id: 't1', msg_id: 'm1', data: 'Done working. ' });
      for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
    });
    expect(synthesizeInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ text: 'Done working.' }) })
    );

    await act(async () => {
      emitStream({ type: 'acp_permission', conversation_id: 'c1', turn_id: 't1' });
      emitStream({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
      for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    });

    expect(synthesizeInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ text: expect.stringContaining('decision') }) })
    );

    // The microphone reopens once the answer and its evidence tail are done.
    transcribeInvoke.mockClear();
    await speakOnce();
    expect(transcribeInvoke).toHaveBeenCalled();
  });

  // A run that ends with nothing said yet — tool calls only, no prose before
  // `finish` — never gives `ensureIncrementalQueueReady` a sentence to claim
  // the turn with. Without its own fallback, `finishIncrementalTurn` would
  // see an unclaimed turn and do nothing, leaving the microphone held until
  // the ten-minute safety timer.
  it('reopens the microphone even when the run finishes with no speakable text of its own', async () => {
    await start(NO_SUMMARY);
    await speakOnce();

    await act(async () => {
      emitStream({ type: 'acp_permission', conversation_id: 'c1', turn_id: 't1' });
      emitStream({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
      for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    });

    expect(synthesizeInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ text: expect.stringContaining('decision') }) })
    );

    transcribeInvoke.mockClear();
    await speakOnce();
    expect(transcribeInvoke).toHaveBeenCalled();
  });
});
