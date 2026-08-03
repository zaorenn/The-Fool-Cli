import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

export type OnboardingProvider = 'codex' | 'claude';
export type OnboardingStatus = 'unavailable' | 'missing' | 'connected' | 'needs-auth' | 'ready-to-check';

export const findOnboardingAgent = (
  agents: readonly ManagedAgent[],
  provider: OnboardingProvider
): ManagedAgent | undefined => agents.find((agent) => agent.agent_source === 'builtin' && agent.backend === provider);

export const getOnboardingStatus = (agent: ManagedAgent | undefined): OnboardingStatus => {
  if (!agent) return 'unavailable';
  if (agent.status === 'missing') return 'missing';
  if (agent.status === 'online') return 'connected';
  if (agent.status === 'offline') return 'needs-auth';
  return 'ready-to-check';
};
