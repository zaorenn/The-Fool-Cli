/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: { list: { invoke: vi.fn().mockResolvedValue([]) } },
    channel: {
      getPlatformSettings: { invoke: vi.fn() },
      setAssistantSetting: { invoke: vi.fn() },
      setDefaultModelSetting: { invoke: vi.fn() },
      syncChannelSettings: { invoke: vi.fn() },
    },
    mode: {
      listProviders: { invoke: vi.fn() },
      createProvider: { invoke: vi.fn() },
    },
  },
}));

import { httpRequest } from '@/common/adapter/httpBridge';
import { migrateConfigStorage, type ConfigFile } from '@/common/config/configMigration';

const configFile = (values: Record<string, unknown> = {}): ConfigFile => ({
  get: vi.fn(async (key: string) => {
    if (key in values) return values[key] as never;
    throw new Error('missing');
  }),
  set: vi.fn(),
});

const backendPreferences = (values: Record<string, unknown>): void => {
  (httpRequest as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
    if (method === 'GET') return Promise.resolve(values);
    return Promise.resolve(undefined);
  });
};

const foolVoiceWrites = (): unknown[] =>
  (httpRequest as ReturnType<typeof vi.fn>).mock.calls
    .filter(([method, path, body]) => method === 'PUT' && path === '/api/settings/client' && 'fool.voice' in body)
    .map(([, , body]) => body['fool.voice']);

describe('Fool voice legacy migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('preserves an existing valid fool.voice preference', async () => {
    backendPreferences({
      'fool.voice': {
        schemaVersion: 1,
        enabled: false,
        tts: { language: 'en' },
      },
      'tools.speechToText': {
        enabled: true,
        provider: 'openai',
        openai: { api_key: 'legacy-secret', model: 'whisper-1', language: 'tr' },
      },
    });

    await migrateConfigStorage(configFile());

    expect(foolVoiceWrites()).toEqual([]);
  });

  it('imports OpenAI metadata from backend preferences without copying the API key', async () => {
    backendPreferences({
      'tools.speechToText': {
        enabled: true,
        provider: 'openai',
        openai: {
          api_key: 'legacy-secret',
          base_url: 'https://speech.example/v1',
          model: 'whisper-large-v3',
          language: 'tr',
        },
      },
    });

    await migrateConfigStorage(configFile());

    expect(foolVoiceWrites()).toHaveLength(1);
    expect(foolVoiceWrites()[0]).toMatchObject({
      enabled: false,
      activation: { talkModeEnabled: false, wakePhrase: { enabled: false } },
      connections: {
        openAICompatible: { baseUrl: 'https://speech.example/v1', credentialId: null },
      },
      stt: { providerId: 'openai-compatible', modelId: 'whisper-large-v3', language: 'tr' },
    });
    expect(JSON.stringify(foolVoiceWrites()[0])).not.toContain('legacy-secret');
    expect(JSON.stringify(foolVoiceWrites()[0])).not.toContain('api_key');
  });

  it('uses the legacy file only when backend tools.speechToText is absent', async () => {
    backendPreferences({});

    await migrateConfigStorage(
      configFile({
        'tools.speechToText': {
          enabled: true,
          provider: 'openai',
          openai: {
            api_key: 'file-secret',
            base_url: 'https://file.example/v1',
            model: 'file-model',
            language: 'en',
          },
        },
      })
    );

    expect(foolVoiceWrites()[0]).toMatchObject({
      enabled: false,
      connections: { openAICompatible: { baseUrl: 'https://file.example/v1', credentialId: null } },
      stt: { providerId: 'openai-compatible', modelId: 'file-model', language: 'en' },
    });
    expect(JSON.stringify(foolVoiceWrites()[0])).not.toContain('file-secret');
  });

  it('leaves Deepgram on the unchanged legacy streaming path', async () => {
    const legacy = {
      enabled: true,
      provider: 'deepgram',
      deepgram: { api_key: 'legacy-secret', model: 'nova-3' },
    };
    backendPreferences({ 'tools.speechToText': legacy });
    const file = configFile({ 'tools.speechToText': legacy });

    await migrateConfigStorage(file);

    expect(foolVoiceWrites()).toEqual([]);
    expect(file.set).not.toHaveBeenCalledWith('tools.speechToText', expect.anything());
  });

  it('never auto-selects local-sherpa from legacy settings', async () => {
    backendPreferences({
      'tools.speechToText': {
        enabled: true,
        provider: 'local-sherpa',
        localSherpa: { model: 'renderer-selected-model', language: 'en' },
      },
    });

    await migrateConfigStorage(configFile());

    expect(foolVoiceWrites()).toEqual([]);
  });

  it('rejects invalid OpenAI metadata without partially trusting it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    backendPreferences({
      'tools.speechToText': {
        enabled: true,
        provider: 'openai',
        openai: {
          api_key: 'legacy-secret',
          base_url: 'file:///secret',
          model: '',
          language: 'tr',
        },
      },
    });

    await migrateConfigStorage(configFile());

    expect(foolVoiceWrites()).toEqual([]);
    expect(warn).toHaveBeenCalledWith('[Migration] fool.voice legacy metadata invalid');
  });
});
