/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The conversation must outlive the page that draws it.
 *
 * Leaving the voice tab to look at something else in the app used to end the
 * conversation, because everything it owned lived in a hook. That is the moment
 * a user is most likely to leave: they asked for something, and they went to
 * watch it happen.
 */

const closed = vi.fn();
const microphoneStopped = vi.fn();
const conversationActive = vi.fn();
const realtimeSession = vi.fn();
const rememberedSessions: string[] = [];

/** Which transport a conversation opens on, switched per test. */
let providerId = 'local-pipeline';

class FakePipeline {
  static instances: FakePipeline[] = [];
  readonly inputSampleRate = 16000;
  constructor(readonly options: { onEvent: (event: unknown) => void }) {
    FakePipeline.instances.push(this);
  }
  connect = vi.fn(async () => {});
  close = closed;
  interrupt = vi.fn();
  pushAudio = vi.fn();
  speakAside = vi.fn(async () => {});
  rememberConversation = vi.fn(async () => {});
}

vi.mock('@/common', () => ({
  ipcBridge: {
    foolVoice: {
      conversationActive: { emit: (payload: { active: boolean }) => conversationActive(payload) },
      holdToTalk: { on: () => () => {} },
      realtimeSession: { invoke: (request: unknown) => realtimeSession(request) },
    },
    shell: { openExternal: { invoke: vi.fn() } },
  },
}));

vi.mock('@/common/config/configService', () => ({
  configService: { get: () => undefined, set: async () => {} },
}));

vi.mock('@renderer/hooks/voice/useFoolVoiceSession', () => ({
  claimManualVoiceSession: () => () => {},
}));

// The page lends the runtime its translations and interface language on every
// render. Without a language the socket path cannot build a persona, which is
// how a test of what a conversation remembers turned into a test of i18n setup.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const memory = { user: '# About you\n', agent: '# How to work with you\n', introduced: true };

vi.mock('@renderer/services/voice/session/voiceMemoryStore', () => ({
  peekVoiceMemory: () => memory,
  readVoiceMemory: async () => memory,
  markVoiceIntroduced: async () => {},
  rememberVoiceSession: async (summary: string) => void rememberedSessions.push(summary),
}));

vi.mock('@renderer/services/voice/voiceSettingsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/services/voice/voiceSettingsStore')>();
  return {
    ...actual,
    peekVoiceSettings: () => {
      const settings = actual.peekVoiceSettings();
      return { ...settings, realtime: { ...settings.realtime, providerId } };
    },
  };
});

vi.mock('@renderer/services/voice/publishVoiceStage', () => ({
  publishVoiceStage: vi.fn(),
  publishVoiceStageOff: vi.fn(),
  publishVoiceActivity: vi.fn(),
  publishVoiceReply: vi.fn(),
  publishVoicePrompt: vi.fn(),
}));

vi.mock('@renderer/pages/voice/localPipeline', () => ({
  LocalVoicePipeline: FakePipeline,
  normalizeEndpoint: (value: string) => value,
}));

vi.mock('@renderer/pages/voice/pcmAudio', () => ({
  PcmAudioOutput: class {
    configure = vi.fn();
    setOutputDevice = vi.fn(async () => {});
    enqueue = vi.fn(async () => {});
    flush = vi.fn();
    close = vi.fn();
    onDrained: (() => void) | null = null;
  },
  PcmMicrophone: class {
    start = vi.fn(async () => {});
    stop = microphoneStopped;
  },
}));

/**
 * A socket provider, close enough to feed it transcripts.
 *
 * Kept as its own class rather than as a stub: the point of the test it exists
 * for is that this transport writes the same session line the local one does,
 * and a client that cannot emit an event proves nothing about that.
 */
class FakeRealtimeClient {
  static last: FakeRealtimeClient | null = null;
  readonly inputSampleRate = 24000;
  readonly outputSampleRate = 24000;
  constructor(readonly options: { onEvent: (event: unknown) => void }) {
    FakeRealtimeClient.last = this;
  }
  connect = vi.fn(async () => {});
  disconnect = vi.fn();
  interrupt = vi.fn();
  appendAudio = vi.fn();
  sendToolResult = vi.fn();
}

vi.mock('@renderer/pages/voice/RealtimeVoiceClient', () => ({ RealtimeVoiceClient: FakeRealtimeClient }));

const { conversationRuntime } = await import('@renderer/pages/voice/runtime/conversationRuntime');
const { useConversation } = await import('@renderer/pages/voice/runtime/useConversation');

const Page: React.FC = () => {
  const conversation = useConversation();
  return <span data-testid='phase'>{conversation.phase}</span>;
};

describe('conversationRuntime', () => {
  beforeEach(() => {
    FakePipeline.instances = [];
    FakeRealtimeClient.last = null;
    providerId = 'local-pipeline';
    rememberedSessions.length = 0;
    closed.mockClear();
    microphoneStopped.mockClear();
    conversationActive.mockClear();
    realtimeSession.mockReset().mockResolvedValue({
      ok: true,
      data: { token: 't', endpoint: 'wss://example.test', ephemeral: true, providerName: 'OpenAI' },
    });
  });

  afterEach(() => {
    conversationRuntime.stop();
  });

  it('keeps listening after the page that started it is unmounted', async () => {
    const view = render(<Page />);
    await conversationRuntime.start();

    expect(view.getByTestId('phase').textContent).toBe('listening');

    view.unmount();

    expect(closed).not.toHaveBeenCalled();
    expect(microphoneStopped).not.toHaveBeenCalled();
    expect(conversationRuntime.getSnapshot().phase).toBe('listening');
  });

  it('shows the conversation still running when the page comes back', async () => {
    render(<Page />).unmount();
    await conversationRuntime.start();

    const returned = render(<Page />);
    expect(returned.getByTestId('phase').textContent).toBe('listening');
    expect(FakePipeline.instances).toHaveLength(1);
  });

  it('does not open a second conversation when start is called twice', async () => {
    render(<Page />);
    await conversationRuntime.start();
    await conversationRuntime.start();

    expect(FakePipeline.instances).toHaveLength(1);
  });

  it('closes everything only when asked to stop', async () => {
    render(<Page />);
    await conversationRuntime.start();

    conversationRuntime.stop();

    expect(closed).toHaveBeenCalledTimes(1);
    expect(microphoneStopped).toHaveBeenCalledTimes(1);
    expect(conversationActive).toHaveBeenLastCalledWith({ active: false });
    expect(conversationRuntime.getSnapshot().phase).toBe('idle');
  });
});

/**
 * What a finished conversation leaves behind.
 *
 * Only the local pipeline used to write a line about a conversation, because
 * only it has a model on the same machine to ask for a summary. A conversation
 * held over OpenAI Realtime or Gemini Live left no trace at all — so on the
 * providers someone is paying for, "yesterday you were stuck on the installer"
 * was never going to be sayable.
 */
describe('what a conversation leaves in the memory', () => {
  beforeEach(() => {
    FakePipeline.instances = [];
    FakeRealtimeClient.last = null;
    rememberedSessions.length = 0;
    realtimeSession.mockReset().mockResolvedValue({
      ok: true,
      data: { token: 't', endpoint: 'wss://example.test', ephemeral: true, providerName: 'OpenAI' },
    });
  });

  afterEach(() => {
    providerId = 'local-pipeline';
    conversationRuntime.stop();
  });

  const say = (role: 'user' | 'assistant', text: string): void =>
    FakeRealtimeClient.last?.options.onEvent({ kind: `${role}-transcript`, text, final: true });

  it('writes a line about a conversation held over a socket, not only a local one', async () => {
    providerId = 'openai-realtime';
    render(<Page />);
    await conversationRuntime.start();

    say('user', 'the installer keeps failing');
    say('assistant', 'let me look');
    say('user', 'it works now, thanks');

    conversationRuntime.stop();

    expect(rememberedSessions).toEqual(['the installer keeps failing … it works now, thanks']);
  });

  it('does not file a single question as a conversation', async () => {
    providerId = 'openai-realtime';
    render(<Page />);
    await conversationRuntime.start();

    say('user', 'what time is it');
    say('assistant', 'half four');

    conversationRuntime.stop();

    expect(rememberedSessions).toEqual([]);
  });

  /**
   * The local pipeline has a model loaded and writes a better line than this
   * can, so it keeps doing that rather than being overwritten by the fallback.
   */
  it('leaves the summary to the local pipeline when there is one', async () => {
    render(<Page />);
    await conversationRuntime.start();

    say('user', 'one');
    say('user', 'two');

    conversationRuntime.stop();

    expect(FakePipeline.instances[0].rememberConversation).toHaveBeenCalledTimes(1);
    expect(rememberedSessions).toEqual([]);
  });
});
