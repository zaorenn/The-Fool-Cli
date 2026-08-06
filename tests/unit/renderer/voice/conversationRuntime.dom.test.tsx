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
}

vi.mock('@/common', () => ({
  ipcBridge: {
    foolVoice: {
      conversationActive: { emit: (payload: { active: boolean }) => conversationActive(payload) },
      holdToTalk: { on: () => () => {} },
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

vi.mock('@renderer/pages/voice/RealtimeVoiceClient', () => ({ RealtimeVoiceClient: class {} }));

const { conversationRuntime } = await import('@renderer/pages/voice/runtime/conversationRuntime');
const { useConversation } = await import('@renderer/pages/voice/runtime/useConversation');

const Page: React.FC = () => {
  const conversation = useConversation();
  return <span data-testid='phase'>{conversation.phase}</span>;
};

describe('conversationRuntime', () => {
  beforeEach(() => {
    FakePipeline.instances = [];
    closed.mockClear();
    microphoneStopped.mockClear();
    conversationActive.mockClear();
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
