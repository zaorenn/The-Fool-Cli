/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';

/**
 * The settings panel, reachable out loud.
 *
 * The failure this is written against is not a crash: it is an assistant that
 * agrees to speak in a male voice and then carries on in the one it had.
 */

let settings: FoolVoiceSettings = structuredClone(DEFAULT_FOOL_VOICE_SETTINGS);
const written: FoolVoiceSettings[] = [];

const catalog = {
  models: [
    {
      id: 'tts-kokoro',
      role: 'text-to-speech',
      providerId: 'local-sherpa',
      state: { status: 'ready' },
      displayName: 'Kokoro',
    },
    {
      id: 'tts-not-installed',
      role: 'text-to-speech',
      providerId: 'local-sherpa',
      state: { status: 'not-installed' },
      displayName: 'Elsewhere',
    },
  ],
  profiles: [
    {
      id: 'af_bella',
      modelId: 'tts-kokoro',
      kind: 'preset',
      state: 'ready',
      displayName: 'Bella (US, female)',
      languages: ['en'],
    },
    {
      id: 'am_adam',
      modelId: 'tts-kokoro',
      kind: 'preset',
      state: 'ready',
      displayName: 'Adam (US, male)',
      languages: ['en'],
    },
    {
      id: 'jarvis',
      modelId: 'tts-kokoro',
      kind: 'cloned',
      state: 'ready',
      displayName: 'Jarvis',
      languages: ['en'],
    },
    {
      id: 'ghost',
      modelId: 'tts-not-installed',
      kind: 'preset',
      state: 'ready',
      displayName: 'Ghost (UK, male)',
      languages: ['en'],
    },
  ],
};

vi.mock('@/common', () => ({
  ipcBridge: { foolVoice: { catalog: { invoke: async () => ({ ok: true, data: catalog }) } } },
}));

vi.mock('@renderer/services/voice/voiceSettingsStore', () => ({
  peekVoiceSettings: () => settings,
  writeVoiceSettings: async (next: FoolVoiceSettings) => {
    settings = next;
    written.push(next);
  },
}));

/** What shape each window is wearing, which a spoken request can change. */
const worn: string[] = [];

/** Which workspace is in force, which a spoken request can also change. */
const entered: string[] = [];

vi.mock('@renderer/hooks/config/useWorkspaces', () => ({
  peekWorkspaces: () => ({
    default: { id: 'default', name: 'Default', builtin: true, layouts: {}, voice: {}, agent: {}, skills: [] },
    guitar: { id: 'guitar', name: 'Guitar tab', builtin: false, layouts: {}, voice: {}, agent: {}, skills: [] },
  }),
  enterWorkspace: async (workspace: { id: string }) => void entered.push(workspace.id),
}));

vi.mock('@renderer/hooks/config/useSurfaceLayout', () => ({
  peekLayoutPresets: () => ({
    'my quiet one': {
      id: 'my quiet one',
      name: 'My quiet one',
      surface: 'voice',
      builtin: false,
      options: { shell: 'hud', meter: 'ring', panel: 'drawer', motion: 'calm', density: 'comfortable' },
    },
  }),
  wearLayout: async (surface: string, layoutId: string) => void worn.push(`${surface}:${layoutId}`),
}));

const { applySpokenSetting, listSpokenVoices } = await import('@renderer/pages/voice/runtime/settingsTool');

const t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${Object.values(values).join(',')}` : key;

describe('the voices offered to the model', () => {
  it('lists only what is installed and ready', async () => {
    const voices = await listSpokenVoices();

    expect(voices.map((voice) => voice.id)).toEqual(['af_bella', 'am_adam', 'jarvis']);
  });

  it('carries the catalog name, which is where male and female come from', async () => {
    const voices = await listSpokenVoices();

    expect(voices.find((voice) => voice.id === 'am_adam')?.label).toBe('Adam (US, male)');
  });

  it('marks a voice the user cloned themselves', async () => {
    const voices = await listSpokenVoices();

    expect(voices.find((voice) => voice.id === 'jarvis')?.cloned).toBe(true);
  });
});

describe('applySpokenSetting', () => {
  beforeEach(() => {
    settings = structuredClone(DEFAULT_FOOL_VOICE_SETTINGS);
    written.length = 0;
  });

  it('changes the voice by id, and records the engine that renders it', async () => {
    await applySpokenSetting('voice', 'am_adam', t);

    expect(settings.tts.profileId).toBe('am_adam');
    expect(settings.tts.modelId).toBe('tts-kokoro');
    expect(settings.tts.providerId).toBeTruthy();
  });

  it('finds a voice by the name the user would say', async () => {
    await applySpokenSetting('voice', 'Jarvis', t);

    expect(settings.tts.profileId).toBe('jarvis');
  });

  it('refuses a voice that is not installed rather than pretending', async () => {
    await expect(applySpokenSetting('voice', 'ghost', t)).rejects.toThrow();
    expect(written).toHaveLength(0);
  });

  it('takes a speaking rate, and clamps one that is out of range', async () => {
    await applySpokenSetting('speed', '1.3', t);
    expect(settings.tts.speed).toBeCloseTo(1.3);

    await applySpokenSetting('speed', '9', t);
    expect(settings.tts.speed).toBe(2);
  });

  it('reads a volume said as a percentage', async () => {
    await applySpokenSetting('volume', '40%', t);

    expect(settings.playback.volume).toBeCloseTo(0.4);
  });

  it('switches hold-to-talk on and off from the words for it', async () => {
    await applySpokenSetting('hold_to_talk', 'on', t);
    expect(settings.activation.conversationHoldToTalk).toBe(true);

    await applySpokenSetting('hold_to_talk', 'off', t);
    expect(settings.activation.conversationHoldToTalk).toBe(false);
  });

  it('understands the words for yes in the language being spoken', async () => {
    await applySpokenSetting('unattended', 'evet', t);

    expect(settings.session.unattended).toBe(true);
  });

  it('holds the reply to a language, and lets it follow the speaker again', async () => {
    await applySpokenSetting('reply_language', 'tr', t);
    expect(settings.realtime.language).toBe('tr');

    await applySpokenSetting('reply_language', 'auto', t);
    expect(settings.realtime.language).toBe('auto');
  });

  it('changes the interrupt word and leaves interrupting switched on', async () => {
    await applySpokenSetting('interrupt_word', 'dur', t);

    expect(settings.playback.interruptPhrase).toBe('dur');
    expect(settings.playback.interruptible).toBe(true);
  });

  it('refuses a persona that does not exist', async () => {
    await expect(applySpokenSetting('persona', 'pirate', t)).rejects.toThrow();
  });

  it('refuses a setting it does not have', async () => {
    await expect(applySpokenSetting('screen_brightness', 'up', t)).rejects.toThrow();
  });
});

/**
 * The shape of the page, changed by saying so.
 *
 * The user is looking at the screen while they ask, so this is the one setting
 * whose result they can check instantly — which cuts both ways: a request that
 * quietly does nothing is obvious, and has to be reported rather than swallowed.
 */
describe('changing the layout out loud', () => {
  beforeEach(() => {
    worn.length = 0;
  });

  it('takes a built-in by name', async () => {
    await applySpokenSetting('layout', 'HUD', t);
    expect(worn).toEqual(['voice:hud']);
  });

  it('takes one the user built and named themselves', async () => {
    await applySpokenSetting('layout', 'my quiet one', t);
    expect(worn).toEqual(['voice:my quiet one']);
  });

  it('takes part of a name, because that is how people refer to their own things', async () => {
    await applySpokenSetting('layout', 'quiet', t);
    expect(worn).toEqual(['voice:my quiet one']);
  });

  it('refuses a layout that does not exist rather than changing nothing in silence', async () => {
    await expect(applySpokenSetting('layout', 'spaceship', t)).rejects.toThrow();
    expect(worn).toEqual([]);
  });
});

/**
 * The largest thing one sentence can change.
 *
 * A workspace moves the layout, the persona, the agent and the model at once,
 * which is exactly why a name that matches nothing has to be refused rather
 * than half-applied.
 */
describe('changing the workspace out loud', () => {
  beforeEach(() => {
    entered.length = 0;
  });

  it('takes one by the name the user gave it', async () => {
    await applySpokenSetting('workspace', 'guitar tab', t);
    expect(entered).toEqual(['guitar']);
  });

  it('takes part of a name, because that is how people refer to their own things', async () => {
    await applySpokenSetting('workspace', 'guitar', t);
    expect(entered).toEqual(['guitar']);
  });

  it('goes back to the shipped one when asked for it', async () => {
    await applySpokenSetting('workspace', 'default', t);
    expect(entered).toEqual(['default']);
  });

  it('refuses one that does not exist rather than changing nothing in silence', async () => {
    await expect(applySpokenSetting('workspace', 'piano', t)).rejects.toThrow();
    expect(entered).toEqual([]);
  });
});

/**
 * Naming a layout that belongs to another window.
 *
 * Now that four surfaces can be shaped, "put the list one on" is a sentence
 * about the Hub, and the person saying it has no idea the app files layouts by
 * window. Making them say which window would be asking them to know the data
 * model. So the name decides the surface: a layout knows what it is for.
 */
describe('changing a layout that belongs to another window', () => {
  beforeEach(() => {
    worn.length = 0;
  });

  it('puts a Hub layout on the Hub, not on the voice page', async () => {
    await applySpokenSetting('layout', 'Index', t);
    expect(worn).toEqual(['hub:index']);
  });

  it('puts a chat layout on the chat window', async () => {
    await applySpokenSetting('layout', 'Transcript', t);
    expect(worn).toEqual(['chat:transcript']);
  });

  it('puts a frame layout on the frame', async () => {
    await applySpokenSetting('layout', 'Focused', t);
    expect(worn).toEqual(['frame:focused']);
  });

  it('still refuses a name no window has', async () => {
    await expect(applySpokenSetting('layout', 'spaceship', t)).rejects.toThrow();
    expect(worn).toEqual([]);
  });
});
