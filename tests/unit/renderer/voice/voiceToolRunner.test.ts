/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationActivity, ToolHost } from '@renderer/pages/voice/runtime/types';

/**
 * What the user is shown while the agent works.
 *
 * A delegated task is minutes of work on a desktop the user cannot see, so the
 * only evidence it is happening is the list of steps on the notch. Written over
 * one line, that list said nothing about progress — the last step and a stuck
 * task look identical.
 */

const runAgentTask = vi.fn();

vi.mock('@renderer/services/voice/session/runAgentTask', () => ({
  runAgentTask: (request: unknown) => runAgentTask(request),
}));

const rememberedFacts: string[] = [];
const rememberedNames: string[] = [];
const forgotten: string[] = [];

vi.mock('@renderer/services/voice/session/voiceMemoryStore', () => ({
  rememberVoiceFact: async (text: string) => void rememberedFacts.push(text),
  rememberVoiceAddress: async (name: string) => void rememberedNames.push(name),
  forgetVoiceFact: async (about: string) => void forgotten.push(about),
}));

vi.mock('@renderer/services/voice/screenSight', () => ({ describeScreen: vi.fn() }));
vi.mock('@renderer/services/voice/voiceSettingsStore', () => ({ peekVoiceSettings: () => ({}) }));
vi.mock('@renderer/utils/theme/applyThemeOverrides', () => ({ applyThemeOverrides: vi.fn() }));
vi.mock('@renderer/pages/voice/localPipeline', () => ({ normalizeEndpoint: (value: string) => value }));
vi.mock('@/common', () => ({ ipcBridge: { shell: { openExternal: { invoke: vi.fn() } } } }));
vi.mock('@/common/config/configService', () => ({
  configService: { get: () => undefined, set: async () => {} },
}));

const { runVoiceTool } = await import('@renderer/pages/voice/runtime/toolRunner');

const activities = new Map<string, ConversationActivity>();

const host: ToolHost = {
  t: (key) => key,
  updateActivity: (id, patch) => {
    const existing = activities.get(id) ?? { id, label: '', detail: '', state: 'running' };
    activities.set(id, { ...existing, ...patch });
  },
  backToListening: vi.fn(),
  flushOutput: vi.fn(),
  setStandby: vi.fn(),
  startWorkingHeartbeat: () => () => {},
};

const steps = (): ConversationActivity[] => [...activities.values()].filter((item) => item.id.includes('#'));

describe('a task handed to the agent', () => {
  beforeEach(() => {
    activities.clear();
    runAgentTask.mockReset();
  });

  it('keeps every step it reported, not only the last one', async () => {
    runAgentTask.mockImplementation(async (request: { onProgress?: (detail: string) => void }) => {
      request.onProgress?.('opening the browser');
      request.onProgress?.('typing the search');
      request.onProgress?.('clicking the third result');
      return { ok: true, conversationId: 'c1', summary: 'done' };
    });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'find the trailer' }),
    });

    expect(steps().map((item) => item.detail)).toEqual([
      'opening the browser',
      'typing the search',
      'clicking the third result',
    ]);
  });

  it('marks each step done as the next one starts, and the last when it ends', async () => {
    runAgentTask.mockImplementation(async (request: { onProgress?: (detail: string) => void }) => {
      request.onProgress?.('opening the browser');
      request.onProgress?.('typing the search');
      return { ok: true, conversationId: 'c1', summary: 'done' };
    });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'find the trailer' }),
    });

    expect(steps().map((item) => item.state)).toEqual(['completed', 'completed']);
  });

  it('drops a step the agent restated, which it does while a tool runs', async () => {
    runAgentTask.mockImplementation(async (request: { onProgress?: (detail: string) => void }) => {
      request.onProgress?.('reading the page');
      request.onProgress?.('reading the page');
      request.onProgress?.('  reading the page  ');
      return { ok: true, conversationId: 'c1', summary: 'done' };
    });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'summarise it' }),
    });

    expect(steps()).toHaveLength(1);
  });

  it('names the parent row with the request, so the list says what it is for', async () => {
    runAgentTask.mockResolvedValue({ ok: true, conversationId: 'c1', summary: 'opened three tabs' });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'find the best mods and open them' }),
    });

    expect(activities.get('call-1')).toMatchObject({
      label: 'find the best mods and open them',
      detail: 'opened three tabs',
      state: 'completed',
    });
  });

  it('keeps a step list even when the task failed', async () => {
    runAgentTask.mockImplementation(async (request: { onProgress?: (detail: string) => void }) => {
      request.onProgress?.('opening the browser');
      return { ok: false, reason: 'run-failed', detail: 'no window' };
    });

    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'find the trailer' }),
    });

    expect(result.ok).toBe(false);
    expect(steps().map((item) => item.state)).toEqual(['completed']);
    expect(activities.get('call-1')?.state).toBe('failed');
  });
});

describe('what it is told to remember', () => {
  beforeEach(() => {
    activities.clear();
    rememberedFacts.length = 0;
    rememberedNames.length = 0;
    forgotten.length = 0;
  });

  it('keeps a name and hands it straight back, so the next sentence can use it', async () => {
    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_remember',
      argumentsJson: JSON.stringify({ callMe: 'Serhan' }),
    });

    expect(rememberedNames).toEqual(['Serhan']);
    expect(result).toMatchObject({ ok: true, callMe: 'Serhan' });
  });

  it('keeps a fact and a name from the same call', async () => {
    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_remember',
      argumentsJson: JSON.stringify({ callMe: 'Serhan', fact: 'Builds a desktop app in the evenings.' }),
    });

    expect(rememberedNames).toEqual(['Serhan']);
    expect(rememberedFacts).toEqual(['Builds a desktop app in the evenings.']);
  });

  it('refuses a call with nothing in it rather than storing a blank', async () => {
    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_remember',
      argumentsJson: JSON.stringify({ fact: '   ' }),
    });

    expect(result.ok).toBe(false);
    expect(rememberedFacts).toEqual([]);
  });

  it('forgets what was named', async () => {
    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_forget',
      argumentsJson: JSON.stringify({ about: 'the walnut thing' }),
    });

    expect(result.ok).toBe(true);
    expect(forgotten).toEqual(['the walnut thing']);
  });
});
