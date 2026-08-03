import { describe, expect, it } from 'vitest';
import { selectReachableLanIPv4 } from '@/process/utils/webuiConfig';

describe('selectReachableLanIPv4', () => {
  it('prefers the physical LAN address over link-local and virtual adapters', () => {
    expect(
      selectReachableLanIPv4({
        Tailscale: [{ address: '169.254.83.107', family: 'IPv4', internal: false }],
        Ethernet: [{ address: '192.168.0.6', family: 'IPv4', internal: false }],
        'vEthernet (Default Switch)': [{ address: '172.18.64.1', family: 'IPv4', internal: false }],
        'vEthernet (WSL)': [{ address: '172.25.128.1', family: 'IPv4', internal: false }],
      })
    ).toBe('192.168.0.6');
  });

  it('returns null when only loopback or link-local addresses exist', () => {
    expect(
      selectReachableLanIPv4({
        Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        Ethernet: [{ address: '169.254.20.10', family: 'IPv4', internal: false }],
      })
    ).toBeNull();
  });
});
