/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishVoiceActivity = vi.fn();
let stage = 'off';

vi.mock('@renderer/services/voice/publishVoiceStage', () => ({
  peekVoiceStage: () => ({ stage }),
  publishVoiceActivity: (lines: unknown) => publishVoiceActivity(lines),
}));

vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/common', () => ({ ipcBridge: { application: {} } }));
vi.mock('@/common/config/configService', () => ({ configService: { get: () => undefined } }));
vi.mock('@/common/voice/localSkills', () => ({ LOCAL_SKILLS_CONFIG_KEY: 'skills' }));
vi.mock('@renderer/services/voice/session/localSkillStore', () => ({ peekLocalSkills: () => [] }));
vi.mock('@renderer/services/permissions/permissionStore', () => ({ judge: () => Promise.resolve('allow') }));
vi.mock('@renderer/pages/voice/runtime/toolRunner', () => ({ runVoiceTool: () => Promise.resolve({}) }));
vi.mock('./toolDescriptors', () => ({ CORE_APP_TOOLS: [], describeAppTools: () => [] }));

/**
 * A tool run by a background agent used to report its progress into a stub.
 * That was right while nobody was looking — and wrong the moment an agent turn
 * is started from inside a live conversation, because then the notch is on
 * screen saying what phase the assistant is in while the work it is narrating
 * happens somewhere that could not report at all.
 */
describe('agent tool progress on the notch', () => {
  beforeEach(() => {
    publishVoiceActivity.mockClear();
  });

  it('says nothing when no conversation is up', async () => {
    stage = 'off';
    const { agentToolHost } = await import('@renderer/services/appTools/appToolChannel');
    agentToolHost('c1').updateActivity('step-1', { label: 'Filling the form' });

    expect(publishVoiceActivity).not.toHaveBeenCalled();
  });

  it('reports progress while somebody is listening', async () => {
    stage = 'listening';
    const { agentToolHost } = await import('@renderer/services/appTools/appToolChannel');
    agentToolHost('c1').updateActivity('step-2', { label: 'Filling the form' });

    expect(publishVoiceActivity).toHaveBeenCalledWith([{ text: 'Filling the form', done: false }]);
  });

  it('prefers the detail over the label, as the spoken runtime does', async () => {
    stage = 'speaking';
    const { agentToolHost } = await import('@renderer/services/appTools/appToolChannel');
    agentToolHost('c1').updateActivity('step-3', { label: 'Filling', detail: 'Page 2 of 4' });

    expect(publishVoiceActivity).toHaveBeenCalledWith(expect.arrayContaining([{ text: 'Page 2 of 4', done: false }]));
  });

  it('marks a finished step done rather than leaving it running forever', async () => {
    stage = 'generating';
    const { agentToolHost } = await import('@renderer/services/appTools/appToolChannel');
    agentToolHost('c1').updateActivity('step-4', { label: 'Saved', state: 'done' });

    expect(publishVoiceActivity).toHaveBeenCalledWith(expect.arrayContaining([{ text: 'Saved', done: true }]));
  });

  it('ignores a patch that carries nothing to show', async () => {
    stage = 'listening';
    const { agentToolHost } = await import('@renderer/services/appTools/appToolChannel');
    publishVoiceActivity.mockClear();
    agentToolHost('c1').updateActivity('step-5', {});

    expect(publishVoiceActivity).not.toHaveBeenCalled();
  });
});
