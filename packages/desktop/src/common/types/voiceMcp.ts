export type VoiceExecuteMcpToolRequest = {
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type VoiceExecuteMcpToolResponse = {
  result: unknown;
};
