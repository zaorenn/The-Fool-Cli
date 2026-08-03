import { describe, expect, it } from 'vitest';
import { findOnboardingAgent, getOnboardingStatus } from '@/renderer/pages/welcome/welcomeModel';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

const agent = (backend: string, status: ManagedAgent['status']): ManagedAgent => ({
  id: `builtin-${backend}`,
  name: backend,
  backend,
  agent_type: 'acp',
  agent_source: 'builtin',
  enabled: true,
  installed: status !== 'missing',
  status,
});

describe('welcomeModel', () => {
  it('finds the builtin provider without depending on a database id', () => {
    const agents = [agent('claude', 'offline'), agent('codex', 'online')];
    expect(findOnboardingAgent(agents, 'codex')?.id).toBe('builtin-codex');
  });

  it('maps catalog state to an honest onboarding state', () => {
    expect(getOnboardingStatus(undefined)).toBe('unavailable');
    expect(getOnboardingStatus(agent('codex', 'missing'))).toBe('missing');
    expect(getOnboardingStatus(agent('codex', 'online'))).toBe('connected');
    expect(getOnboardingStatus(agent('claude', 'offline'))).toBe('needs-auth');
    expect(getOnboardingStatus(agent('claude', 'unchecked'))).toBe('ready-to-check');
  });
});
