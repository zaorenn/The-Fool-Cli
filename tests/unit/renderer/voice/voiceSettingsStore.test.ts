/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS } from '@/common/types/foolVoice';

const getClientBusinessSetting = vi.fn();
const setClientBusinessSetting = vi.fn().mockResolvedValue(undefined);

vi.mock('@renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: (key: string) => getClientBusinessSetting(key),
  setClientBusinessSetting: (key: string, value: unknown) => setClientBusinessSetting(key, value),
}));

const importStore = async () => {
  vi.resetModules();
  return import('@renderer/services/voice/voiceSettingsStore');
};

describe('voiceSettingsStore', () => {
  beforeEach(() => {
    getClientBusinessSetting.mockReset();
    setClientBusinessSetting.mockClear();
    getClientBusinessSetting.mockResolvedValue(undefined);
  });

  it('falls back to the defaults when nothing is stored', async () => {
    const store = await importStore();

    const settings = await store.readVoiceSettings();

    expect(settings).toEqual(DEFAULT_FOOL_VOICE_SETTINGS);
    expect(getClientBusinessSetting).toHaveBeenCalledWith('fool.voice');
  });

  it('returns the stored devices instead of the defaults', async () => {
    getClientBusinessSetting.mockResolvedValue({
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      devices: { inputDeviceId: 'mic-2', outputDeviceId: 'speaker-7' },
    });
    const store = await importStore();

    const settings = await store.readVoiceSettings();

    expect(settings.devices).toEqual({ inputDeviceId: 'mic-2', outputDeviceId: 'speaker-7' });
  });

  it('repairs corrupt stored settings rather than throwing', async () => {
    getClientBusinessSetting.mockResolvedValue({ devices: { inputDeviceId: 42 }, tts: 'nonsense' });
    const store = await importStore();

    const settings = await store.readVoiceSettings();

    expect(settings).toEqual(DEFAULT_FOOL_VOICE_SETTINGS);
  });

  it('reads the backend once however many callers ask', async () => {
    const store = await importStore();

    await Promise.all([store.readVoiceSettings(), store.readVoiceSettings()]);
    await store.readVoiceSettings();

    expect(getClientBusinessSetting).toHaveBeenCalledTimes(1);
  });

  it('persists a write and serves it to later readers', async () => {
    const store = await importStore();
    await store.readVoiceSettings();

    const next = { ...DEFAULT_FOOL_VOICE_SETTINGS, tts: { ...DEFAULT_FOOL_VOICE_SETTINGS.tts, speed: 1.4 } };
    await store.writeVoiceSettings(next);

    expect(setClientBusinessSetting).toHaveBeenCalledWith('fool.voice', next);
    expect(store.peekVoiceSettings().tts.speed).toBe(1.4);
    await expect(store.readVoiceSettings()).resolves.toEqual(next);
  });

  it('tells every subscriber about a write, so other surfaces pick up a new device', async () => {
    const store = await importStore();
    const listener = vi.fn();
    store.subscribeVoiceSettings(listener);

    await store.writeVoiceSettings({
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      devices: { inputDeviceId: 'mic-9', outputDeviceId: null },
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ devices: { inputDeviceId: 'mic-9', outputDeviceId: null } })
    );
  });

  it('stops notifying an unsubscribed listener', async () => {
    const store = await importStore();
    const listener = vi.fn();
    store.subscribeVoiceSettings(listener)();

    await store.writeVoiceSettings(DEFAULT_FOOL_VOICE_SETTINGS);

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the new settings visible even when the backend write fails', async () => {
    setClientBusinessSetting.mockRejectedValueOnce(new Error('offline'));
    const store = await importStore();

    await expect(store.writeVoiceSettings({ ...DEFAULT_FOOL_VOICE_SETTINGS, enabled: true })).resolves.toBeUndefined();

    expect(store.peekVoiceSettings().enabled).toBe(true);
  });

  it('survives a backend read failure by serving the defaults', async () => {
    getClientBusinessSetting.mockRejectedValue(new Error('offline'));
    const store = await importStore();

    await expect(store.readVoiceSettings()).resolves.toEqual(DEFAULT_FOOL_VOICE_SETTINGS);
  });
});
