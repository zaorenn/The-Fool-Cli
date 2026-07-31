/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  summarizeCron,
  summarizeMcp,
  summarizeProviders,
  summarizeRunningConversations,
} from '@/renderer/pages/settings/overviewSignals';

describe('summarizeProviders', () => {
  it('flags a model whose status is not healthy', () => {
    const result = summarizeProviders([
      { id: 'p1', name: 'OpenAI', model_health: { 'gpt-4.1': { status: 'unhealthy', error: 'timeout' } } },
    ]);

    expect(result.total).toBe(1);
    expect(result.unhealthy).toEqual([{ provider: 'OpenAI', model: 'gpt-4.1', status: 'unhealthy', error: 'timeout' }]);
  });

  it('does not flag a provider that has never been checked', () => {
    // No `model_health` at all — never checked, not the same as failing.
    const result = summarizeProviders([{ id: 'p1', name: 'OpenAI' }]);

    expect(result.unhealthy).toEqual([]);
  });

  it('leaves a healthy model out of the flagged list', () => {
    const result = summarizeProviders([
      { id: 'p1', name: 'OpenAI', model_health: { 'gpt-4.1': { status: 'healthy' } } },
    ]);

    expect(result.unhealthy).toEqual([]);
  });
});

describe('summarizeMcp', () => {
  it('flags an enabled server with zero tools', () => {
    const result = summarizeMcp([{ id: 's1', name: 'Local Tools', enabled: true, tools: [] }]);

    expect(result.enabledButNoTools).toEqual([{ id: 's1', name: 'Local Tools' }]);
  });

  it('does not flag a disabled server with zero tools', () => {
    // Disabled and toolless is the expected resting state, not a symptom.
    const result = summarizeMcp([{ id: 's1', name: 'Local Tools', enabled: false, tools: [] }]);

    expect(result.enabledButNoTools).toEqual([]);
  });

  it('does not flag an enabled server that has tools', () => {
    const result = summarizeMcp([{ id: 's1', name: 'Local Tools', enabled: true, tools: ['a', 'b'] }]);

    expect(result.enabledButNoTools).toEqual([]);
  });

  it('accepts a tool count sent as a bare number', () => {
    const result = summarizeMcp([{ id: 's1', name: 'Local Tools', enabled: true, tools: 3 }]);

    expect(result.enabledButNoTools).toEqual([]);
  });
});

describe('summarizeCron', () => {
  it('flags an errored job and a missed job, but not a healthy one', () => {
    const result = summarizeCron([
      { id: 'c1', name: 'Daily Summary', last_status: 'error', last_error: 'timeout' },
      { id: 'c2', name: 'Weekly Report', last_status: 'missed', last_error: null },
      { id: 'c3', name: 'Backup', last_status: 'success', last_error: null },
    ]);

    expect(result.total).toBe(3);
    expect(result.failing.map((job) => job.id)).toEqual(['c1', 'c2']);
    expect(result.failing[0].lastError).toBe('timeout');
  });
});

describe('summarizeRunningConversations', () => {
  it('matches on the persisted status field', () => {
    const result = summarizeRunningConversations([{ id: 'conv1', name: 'Fix the bug', status: 'running' }]);

    expect(result).toEqual([{ id: 'conv1', name: 'Fix the bug' }]);
  });

  it('matches on the live runtime state when status has not caught up', () => {
    const result = summarizeRunningConversations([
      { id: 'conv1', name: 'Fix the bug', status: 'pending', runtime: { state: 'running' } },
    ]);

    expect(result).toEqual([{ id: 'conv1', name: 'Fix the bug' }]);
  });

  it('excludes a finished conversation', () => {
    const result = summarizeRunningConversations([
      { id: 'conv1', name: 'Fix the bug', status: 'finished', runtime: { state: 'idle' } },
    ]);

    expect(result).toEqual([]);
  });
});
