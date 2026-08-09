/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingAsks, offersAlways } from '@/common/permissions/pendingAsks';

describe('PendingAsks', () => {
  beforeEach(() => vi.useRealTimers());

  it('resolves with what the user chose', async () => {
    const pending = new PendingAsks(1000);
    const asked = pending.ask({ tool: 'Bash', command: 'git push origin main' }, 'c1');

    const [outstanding] = pending.outstanding();
    pending.answer(outstanding.id, 'allow');

    await expect(asked).resolves.toBe('allow');
  });

  it('refuses when nobody answers', async () => {
    // Nobody is looking at a dialog during a spoken conversation, so an
    // unanswered ask has to resolve — and it has to resolve to no.
    const pending = new PendingAsks(20);
    await expect(pending.ask({ tool: 'Bash', command: 'rm -rf D:/work' }, 'c1')).resolves.toBe('deny');
  });

  it('refuses everything outstanding when the conversation ends', async () => {
    const pending = new PendingAsks(10_000);
    const first = pending.ask({ tool: 'Bash', command: 'rm -rf a' }, 'c1');
    const second = pending.ask({ tool: 'Bash', command: 'rm -rf b' }, 'c1');
    const other = pending.ask({ tool: 'Bash', command: 'rm -rf c' }, 'c2');

    pending.conversationEnded('c1');

    await expect(first).resolves.toBe('deny');
    await expect(second).resolves.toBe('deny');
    expect(pending.outstanding()).toHaveLength(1);
    pending.answer(pending.outstanding()[0].id, 'allow');
    await expect(other).resolves.toBe('allow');
  });

  it('answering something unknown changes nothing and does not throw', () => {
    const pending = new PendingAsks(1000);
    expect(() => pending.answer('never-asked', 'allow')).not.toThrow();
  });

  it('describes what is being asked about, so a card can be drawn', async () => {
    const pending = new PendingAsks(1000);
    void pending.ask({ tool: 'Bash', command: 'git push origin main' }, 'c1');

    const [outstanding] = pending.outstanding();
    expect(outstanding.conversationId).toBe('c1');
    expect(outstanding.call.tool).toBe('Bash');
    expect(outstanding.call.command).toBe('git push origin main');
  });
});

describe('offersAlways', () => {
  it('does not offer "always" for anything that sends', () => {
    // The cost of a wrong send is not paid by the person who clicked allow.
    expect(offersAlways({ tool: 'app_send_message' })).toBe(false);
    expect(offersAlways({ tool: 'app_send_email' })).toBe(false);
  });

  it('does offer it for something repetitive and reversible', () => {
    expect(offersAlways({ tool: 'Bash', command: 'git push origin main' })).toBe(true);
  });
});
