/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_VOICE_MEMORY } from '@/common/voice/memory';
import type { AgentTaskStep } from '@renderer/services/voice/session/runAgentTask';
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
const rememberedMeanings: string[] = [];
const forgotten: string[] = [];
const lessons: string[] = [];
const skills: { name: string; when: string; steps: string }[] = [];
const forgottenSkills: string[] = [];
const forgottenLessons: string[] = [];

vi.mock('@renderer/services/voice/session/voiceMemoryStore', () => ({
  peekVoiceMemory: () => EMPTY_VOICE_MEMORY,
  rememberVoiceFact: async (text: string) => void rememberedFacts.push(text),
  rememberVoiceAddress: async (name: string) => void rememberedNames.push(name),
  rememberVoiceMeaning: async (word: string, means: string) => void rememberedMeanings.push(`${word}=${means}`),
  forgetVoiceFact: async (about: string) => void forgotten.push(about),
  learnVoiceLesson: async (lesson: string) => void lessons.push(lesson),
  learnVoiceSkill: async (skill: { name: string; when: string; steps: string }) => void skills.push(skill),
  forgetVoiceSkill: async (name: string) => void forgottenSkills.push(name),
  forgetVoiceLesson: async (about: string) => void forgottenLessons.push(about),
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

/** Everything the runtime was asked to volunteer once the work finished. */
const announced: { what: string; finished: Promise<{ ok: boolean; detail: string }> }[] = [];

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
  setSessionRule: vi.fn(),
  dropSessionRule: vi.fn(),
  announceLater: (what, finished) => void announced.push({ what, finished }),
};

/**
 * Waits for the work the tool call did not wait for.
 *
 * The activity rows are written when the task finishes, which is now after the
 * turn has ended — so a test that asserts on them has to wait for the thing the
 * conversation deliberately does not.
 */
const settled = async (): Promise<void> => {
  await Promise.all(announced.map((task) => task.finished));
};

const steps = (): ConversationActivity[] =>
  [...activities.values()].filter((item) => item.id.includes('#') && !item.id.endsWith('#writing'));

type Reporter = { onProgress?: (step: AgentTaskStep) => void };
const step = (text: string): AgentTaskStep => ({ kind: 'step', text });

describe('a task handed to the agent', () => {
  beforeEach(() => {
    activities.clear();
    lessons.length = 0;
    announced.length = 0;
    runAgentTask.mockReset();
  });

  it('keeps every step it reported, not only the last one', async () => {
    runAgentTask.mockImplementation(async (request: Reporter) => {
      request.onProgress?.(step('opening the browser'));
      request.onProgress?.(step('typing the search'));
      request.onProgress?.(step('clicking the third result'));
      return { ok: true, conversationId: 'c1', summary: 'done' };
    });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'find the trailer' }),
    });
    await settled();

    expect(steps().map((item) => item.detail)).toEqual([
      'opening the browser',
      'typing the search',
      'clicking the third result',
    ]);
  });

  it('marks each step done as the next one starts, and the last when it ends', async () => {
    runAgentTask.mockImplementation(async (request: Reporter) => {
      request.onProgress?.(step('opening the browser'));
      request.onProgress?.(step('typing the search'));
      return { ok: true, conversationId: 'c1', summary: 'done' };
    });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'find the trailer' }),
    });
    await settled();

    expect(steps().map((item) => item.state)).toEqual(['completed', 'completed']);
  });

  it('drops a step the agent restated, which it does while a tool runs', async () => {
    runAgentTask.mockImplementation(async (request: Reporter) => {
      request.onProgress?.(step('reading the page'));
      request.onProgress?.(step('reading the page'));
      request.onProgress?.(step('  reading the page  '));
      return { ok: true, conversationId: 'c1', summary: 'done' };
    });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'summarise it' }),
    });
    await settled();

    expect(steps()).toHaveLength(1);
  });

  it('names the parent row with the request, so the list says what it is for', async () => {
    runAgentTask.mockResolvedValue({ ok: true, conversationId: 'c1', summary: 'opened three tabs' });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'find the best mods and open them' }),
    });
    await settled();

    expect(activities.get('call-1')).toMatchObject({
      label: 'find the best mods and open them',
      detail: 'opened three tabs',
      state: 'completed',
    });
  });

  it('keeps a step list even when the task failed', async () => {
    runAgentTask.mockImplementation(async (request: Reporter) => {
      request.onProgress?.(step('opening the browser'));
      return { ok: false, reason: 'run-failed', detail: 'no window' };
    });

    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'find the trailer' }),
    });
    await settled();

    // The call itself succeeded: the task was accepted. Whether the work went
    // well is not known when the turn ends, and a tool result that says it did
    // is the exact false report the honesty work exists to stop.
    expect(result).toMatchObject({ ok: true, accepted: true });
    expect(steps().map((item) => item.state)).toEqual(['completed']);
    expect(activities.get('call-1')?.state).toBe('failed');
  });

  /**
   * The bug this whole distinction exists for. The answer arrives a fragment at
   * a time, and reported as steps it produced one row per token — the panel
   * spelling out the reply instead of saying what the agent was doing.
   */
  it('does not open a row per fragment of the answer being written', async () => {
    runAgentTask.mockImplementation(async (request: Reporter) => {
      request.onProgress?.({ kind: 'writing', text: 'I have' });
      request.onProgress?.({ kind: 'writing', text: 'I have opened' });
      request.onProgress?.({ kind: 'writing', text: 'I have opened the page.' });
      return { ok: true, conversationId: 'c1', summary: 'done' };
    });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'open it' }),
    });
    await settled();

    expect(steps()).toHaveLength(0);
    expect(activities.get('call-1#writing')).toMatchObject({
      detail: 'I have opened the page.',
      state: 'completed',
    });
  });

  /**
   * One row instead of a hundred was only half of it. The row's own text still
   * changed on every token, so the page and the notch went on showing running
   * letters — nobody reads a line that is being retyped thirty times a second.
   */
  it('moves the writing row on a finished sentence, not on every token', async () => {
    const writes: string[] = [];
    const watching: ToolHost = {
      ...host,
      updateActivity: (id, patch) => {
        if (id.endsWith('#writing') && patch.detail !== undefined) writes.push(patch.detail);
        host.updateActivity(id, patch);
      },
    };

    runAgentTask.mockImplementation(async (request: Reporter) => {
      for (const text of ['I', 'I have', 'I have opened', 'I have opened it.', 'I have opened it. Next']) {
        request.onProgress?.({ kind: 'writing', text });
      }
      request.onProgress?.({ kind: 'writing', text: 'I have opened it. Next I searched.' });
      return { ok: true, conversationId: 'c1', summary: 'done' };
    });

    await runVoiceTool(watching, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'open it' }),
    });
    await settled();

    // Six fragments in, three writes out: the row going up, and one per
    // sentence that actually finished.
    expect(writes).toEqual(['', 'I have opened it.', 'Next I searched.']);
  });

  it('writes down a failure that will happen again, so it is not learned twice', async () => {
    runAgentTask.mockResolvedValue({ ok: false, reason: 'agent-unavailable', detail: 'no agent' });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'send the email' }),
    });
    await settled();

    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toContain('send the email');
  });

  it('does not write down a failure that says nothing about the request', async () => {
    runAgentTask.mockResolvedValue({ ok: false, reason: 'cancelled' });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'send the email' }),
    });
    await settled();

    expect(lessons).toEqual([]);
  });

  it('sends what it knows about the user along with the job', async () => {
    runAgentTask.mockResolvedValue({ ok: true, conversationId: 'c1', summary: 'done' });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'put it on my desktop' }),
    });
    await settled();

    expect(runAgentTask).toHaveBeenCalledWith(expect.objectContaining({ memory: EMPTY_VOICE_MEMORY }));
  });
});

describe('what it is told to remember', () => {
  beforeEach(() => {
    activities.clear();
    rememberedFacts.length = 0;
    rememberedNames.length = 0;
    rememberedMeanings.length = 0;
    forgotten.length = 0;
    lessons.length = 0;
    skills.length = 0;
    forgottenSkills.length = 0;
    forgottenLessons.length = 0;
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

  it('keeps what one of their own words means, which is what the agent needs to act', async () => {
    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_remember',
      argumentsJson: JSON.stringify({ word: 'my desktop', means: 'C:\\Users\\example\\Desktop' }),
    });

    expect(result.ok).toBe(true);
    expect(rememberedMeanings).toEqual(['my desktop=C:\\Users\\example\\Desktop']);
    expect(rememberedFacts).toEqual([]);
  });

  it('sends a forget to the right document, so a skill is not looked for among the facts', async () => {
    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_forget',
      argumentsJson: JSON.stringify({ about: 'find a video', scope: 'skill' }),
    });
    await runVoiceTool(host, {
      callId: 'call-2',
      name: 'app_forget',
      argumentsJson: JSON.stringify({ about: 'the installer thing', scope: 'lesson' }),
    });

    expect(forgottenSkills).toEqual(['find a video']);
    expect(forgottenLessons).toEqual(['the installer thing']);
    expect(forgotten).toEqual([]);
  });
});

describe('what it is taught', () => {
  beforeEach(() => {
    activities.clear();
    lessons.length = 0;
    skills.length = 0;
  });

  it('writes down a correction as a lesson', async () => {
    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_learn',
      argumentsJson: JSON.stringify({ lesson: 'They mean the folder, not the app.' }),
    });

    expect(result.ok).toBe(true);
    expect(lessons).toEqual(['They mean the folder, not the app.']);
  });

  it('keeps a way of doing things they taught, under their own name for it', async () => {
    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_learn',
      argumentsJson: JSON.stringify({
        skillName: 'Find a video',
        skillWhen: 'I ask you to play a song',
        skillSteps: 'search YouTube and open the first result',
      }),
    });

    expect(skills).toEqual([
      { name: 'Find a video', when: 'I ask you to play a song', steps: 'search YouTube and open the first result' },
    ]);
  });

  it('refuses a skill with a name and no steps, which would teach nothing', async () => {
    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_learn',
      argumentsJson: JSON.stringify({ skillName: 'Find a video' }),
    });

    expect(result.ok).toBe(false);
    expect(skills).toEqual([]);
  });
});

describe('searching inside a site', () => {
  beforeEach(() => {
    activities.clear();
    runAgentTask.mockReset();
  });

  it('goes straight to the results rather than handing it to the agent', async () => {
    const { ipcBridge } = await import('@/common');
    const openExternal = vi.mocked(ipcBridge.shell.openExternal.invoke);
    openExternal.mockClear();

    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_search',
      argumentsJson: JSON.stringify({ site: 'youtube', query: 'bohemian rhapsody' }),
    });

    expect(result).toMatchObject({ ok: true, site: 'youtube' });
    expect(openExternal).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=bohemian+rhapsody');
    expect(runAgentTask).not.toHaveBeenCalled();
  });

  it('refuses a search with nothing to search for', async () => {
    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_search',
      argumentsJson: JSON.stringify({ site: 'youtube', query: '   ' }),
    });

    expect(result.ok).toBe(false);
  });
});

/**
 * The turn does not wait for the work.
 *
 * Awaiting the task inside the call held the spoken turn open for as long as
 * the agent ran — minutes — so the conversation could not go anywhere else and
 * a second request had to queue behind the first. Delegating that you have to
 * sit and watch is not delegating.
 */
describe('a task the conversation does not wait for', () => {
  beforeEach(() => {
    activities.clear();
    announced.length = 0;
    runAgentTask.mockReset();
  });

  it('comes back as soon as the work is accepted', async () => {
    let finish: (outcome: unknown) => void = () => undefined;
    runAgentTask.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'book a flight to Tokyo' }),
    });

    // Returned while the task is still running: nothing has resolved it yet.
    expect(result).toMatchObject({ ok: true, accepted: true });
    expect(announced).toHaveLength(1);
    expect(announced[0].what).toBe('book a flight to Tokyo');

    finish({ ok: true, conversationId: 'c1', summary: 'Booked.' });
    await expect(announced[0].finished).resolves.toMatchObject({ ok: true, detail: 'Booked.' });
  });

  it('says nothing about how it went, because nothing is known yet', async () => {
    runAgentTask.mockReturnValue(new Promise(() => undefined));

    const result = await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'tidy the downloads folder' }),
    });

    expect(JSON.stringify(result)).not.toContain('summary');
    expect(activities.get('call-1')?.state).toBe('running');
  });

  it('hands over the failure too, rather than swallowing it', async () => {
    runAgentTask.mockResolvedValue({ ok: false, reason: 'agent-unavailable', detail: 'no agent' });

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'buy a ticket' }),
    });

    await expect(announced[0].finished).resolves.toMatchObject({ ok: false });
    expect(lessons).toHaveLength(1);
  });

  it('takes a second task while the first is still running', async () => {
    runAgentTask.mockReturnValue(new Promise(() => undefined));

    await runVoiceTool(host, {
      callId: 'call-1',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'first job' }),
    });
    await runVoiceTool(host, {
      callId: 'call-2',
      name: 'app_ask_jester',
      argumentsJson: JSON.stringify({ request: 'second job' }),
    });

    expect(announced.map((task) => task.what)).toEqual(['first job', 'second job']);
  });
});
