/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryProposal } from '@/common/voice/memoryProposal';

/**
 * Agreeing, or not, with what the assistant thinks it learned.
 *
 * The half this completes: proposals have been filterable, de-duplicable and
 * recordable since the module was written, and nothing ever produced one or
 * showed one. What the user experienced was an assistant with a memory it did
 * not visibly use.
 */

let stored: MemoryProposal[] = [];
const accepted: MemoryProposal[] = [];
const refused: MemoryProposal[] = [];

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: () => stored,
    set: async () => undefined,
    subscribe: () => () => undefined,
  },
}));

vi.mock('@renderer/services/voice/session/voiceMemoryStore', () => ({
  acceptMemoryProposal: async (proposal: MemoryProposal) => void accepted.push(proposal),
  refuseMemoryProposal: async (proposal: MemoryProposal) => void refused.push(proposal),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { default: ProposalList } =
  await import('@renderer/components/settings/SettingsModal/contents/memory/ProposalList');

const proposal = (line: string, evidence: string): MemoryProposal => ({ target: 'user', line, evidence });

describe('what the assistant thinks it learned', () => {
  beforeEach(() => {
    stored = [];
    accepted.length = 0;
    refused.length = 0;
  });

  /// The usual state, and it should take up no room on the page.
  it('shows nothing when it has learned nothing', () => {
    const { container } = render(<ProposalList />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the line and the words it came from', () => {
    stored = [proposal('Plays guitar.', 'gitar çalıyorum akşamları')];
    render(<ProposalList />);

    expect(screen.getByText('Plays guitar.')).toBeTruthy();
    // Quoted rather than summarised: a paraphrase is one more thing to trust.
    expect(screen.getByText(/gitar çalıyorum akşamları/)).toBeTruthy();
  });

  it('writes it only once the user agrees', async () => {
    stored = [proposal('Plays guitar.', 'gitar çalıyorum')];
    render(<ProposalList />);

    expect(accepted).toEqual([]);
    fireEvent.click(screen.getByText('settings.memory.learned.accept'));

    await waitFor(() => expect(accepted).toHaveLength(1));
    expect(accepted[0].line).toBe('Plays guitar.');
    expect(refused).toEqual([]);
  });

  /// Being told no has to mean something, or the same sentence comes back
  /// every evening and the user learns to click through it.
  it('records a refusal rather than dropping it', async () => {
    stored = [proposal('Hates jazz.', 'bilmem, olabilir')];
    render(<ProposalList />);

    fireEvent.click(screen.getByText('settings.memory.learned.refuse'));

    await waitFor(() => expect(refused).toHaveLength(1));
    expect(refused[0].line).toBe('Hates jazz.');
    expect(accepted).toEqual([]);
  });

  it('offers each one its own pair of answers', () => {
    stored = [proposal('Plays guitar.', 'a'), proposal('Works late.', 'b')];
    render(<ProposalList />);

    expect(screen.getAllByText('settings.memory.learned.accept')).toHaveLength(2);
    expect(screen.getAllByText('settings.memory.learned.refuse')).toHaveLength(2);
  });
});
