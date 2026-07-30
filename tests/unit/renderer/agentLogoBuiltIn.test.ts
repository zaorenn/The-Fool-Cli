/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/assets/logos/brand/app.png', () => ({ default: '/assets/brand-app.png' }));
vi.mock('@/common', () => ({ ipcBridge: { acpConversation: { getManagedAgents: { invoke: vi.fn() } } } }));

const { resolveAgentAvatar, resolveAgentLogo } = await import('@renderer/utils/model/agentLogo');

/**
 * The agent that ships inside the app wears the app's own mark.
 *
 * Its logo otherwise comes from the backend catalog, which is served by a binary
 * this repository does not build — so it arrives carrying the upstream project's
 * branding, and there is no way to change it at the source.
 */
describe('the built-in agent logo', () => {
  it('uses the app mark rather than whatever the backend catalog carries', () => {
    const catalog = { aionrs: 'https://example.com/upstream-logo.png' };

    expect(resolveAgentLogo(catalog, { backend: 'aionrs' })).toBe('/assets/brand-app.png');
  });

  it('does the same for the avatar shape', () => {
    expect(resolveAgentAvatar({}, { backend: 'aionrs' })).toEqual({
      kind: 'image',
      value: '/assets/brand-app.png',
    });
  });

  it('matches however the backend cases the identifier', () => {
    expect(resolveAgentLogo({}, { backend: 'AionRs' })).toBe('/assets/brand-app.png');
    expect(resolveAgentLogo({}, { backend: ' aionrs ' })).toBe('/assets/brand-app.png');
  });

  // A logo the user set on their own assistant is theirs, not ours to override.
  it('still lets an explicit icon win', () => {
    expect(resolveAgentLogo({}, { backend: 'aionrs', icon: 'https://example.com/mine.png' })).toBe(
      'https://example.com/mine.png'
    );
  });

  it('leaves every other agent on the backend catalog', () => {
    const catalog = { claude: 'https://example.com/claude.png' };

    expect(resolveAgentLogo(catalog, { backend: 'claude' })).toBe('https://example.com/claude.png');
    expect(resolveAgentLogo(catalog, { backend: 'nanobot' })).toBeNull();
  });
});
