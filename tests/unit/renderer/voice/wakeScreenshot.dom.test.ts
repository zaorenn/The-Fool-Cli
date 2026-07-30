/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';

const listProviders = vi.fn();
const capture = vi.fn();
const upload = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: { mode: { listProviders: { invoke: () => listProviders() } } },
}));

vi.mock('@renderer/services/FileService', () => ({
  uploadFileViaHttp: (file: File, conversationId?: string, onProgress?: unknown, name?: string) =>
    upload(file, conversationId, onProgress, name),
}));

const { captureVoiceScreenshot, modelAcceptsImages } = await import('@renderer/services/voice/session/wakeScreenshot');

const provider = (overrides: Partial<IProvider> = {}): IProvider => ({
  id: 'lmstudio',
  platform: 'openai',
  name: 'LM Studio (Local)',
  base_url: 'http://127.0.0.1:1234/v1',
  api_key: 'sk-local',
  models: ['qwen/qwen3.5-9b'],
  ...overrides,
});

const settings = (session: Partial<FoolVoiceSettings['session']> = {}): FoolVoiceSettings => ({
  ...DEFAULT_FOOL_VOICE_SETTINGS,
  session: {
    ...DEFAULT_FOOL_VOICE_SETTINGS.session,
    providerId: 'lmstudio',
    modelId: 'qwen/qwen3.5-9b',
    ...session,
  },
});

/** A provider that has told us, explicitly, that its model reads images. */
const visionProvider = () => provider({ model_settings: { 'qwen/qwen3.5-9b': { image_input: 'supported' } } });

describe('captureVoiceScreenshot', () => {
  beforeEach(() => {
    listProviders.mockReset();
    capture.mockReset();
    upload.mockReset();
    listProviders.mockResolvedValue([visionProvider()]);
    capture.mockResolvedValue({ filename: 'screenshot-1.png', data: [1, 2, 3, 4] });
    upload.mockResolvedValue('C:/uploads/screenshot-1.png');
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      captureFeedbackScreenshot: () => capture(),
    };
  });

  it('sends the screen when the model can look at it', async () => {
    const attachment = await captureVoiceScreenshot(settings());

    expect(attachment).toMatchObject({
      name: 'screenshot-1.png',
      path: 'C:/uploads/screenshot-1.png',
      size: 4,
      type: 'image/png',
    });
  });

  it('skips a text-only model in silence', async () => {
    listProviders.mockResolvedValue([
      provider({ model_settings: { 'qwen/qwen3.5-9b': { image_input: 'unsupported' } } }),
    ]);

    expect(await captureVoiceScreenshot(settings())).toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });

  it('skips a model nobody has said anything about', async () => {
    // A guess that turns into a rejected request is worse than no screenshot.
    listProviders.mockResolvedValue([provider()]);

    expect(await captureVoiceScreenshot(settings())).toBeNull();
  });

  it('does nothing when the setting is off', async () => {
    expect(await captureVoiceScreenshot(settings({ attachScreenshot: false }))).toBeNull();
    expect(listProviders).not.toHaveBeenCalled();
  });

  it('does nothing when no model is pinned', async () => {
    expect(await captureVoiceScreenshot(settings({ modelId: '' }))).toBeNull();
  });

  it('lets the turn go ahead when the capture fails', async () => {
    capture.mockResolvedValue(null);

    expect(await captureVoiceScreenshot(settings())).toBeNull();
  });

  it('lets the turn go ahead when the upload fails', async () => {
    upload.mockRejectedValue(new Error('backend down'));

    expect(await captureVoiceScreenshot(settings())).toBeNull();
  });

  it('lets the turn go ahead where there is no capture at all', async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = {};

    expect(await captureVoiceScreenshot(settings())).toBeNull();
  });
});

describe('modelAcceptsImages', () => {
  it('believes an explicit yes', () => {
    expect(modelAcceptsImages(visionProvider(), 'qwen/qwen3.5-9b')).toBe(true);
  });

  it('believes an explicit no over any name matching', () => {
    const said = provider({ models: ['gpt-4o'], model_settings: { 'gpt-4o': { image_input: 'unsupported' } } });

    expect(modelAcceptsImages(said, 'gpt-4o')).toBe(false);
  });

  it('falls back to the name when nothing was said', () => {
    expect(modelAcceptsImages(provider({ models: ['gpt-4o'] }), 'gpt-4o')).toBe(true);
  });

  it('treats an unrecognised name as a no', () => {
    expect(modelAcceptsImages(provider(), 'some-local-gguf')).toBe(false);
  });

  it('treats a missing provider as a no', () => {
    expect(modelAcceptsImages(undefined, 'gpt-4o')).toBe(false);
  });
});
