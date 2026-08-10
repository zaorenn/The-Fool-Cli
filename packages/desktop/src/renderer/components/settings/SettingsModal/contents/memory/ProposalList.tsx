/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { configService } from '@/common/config/configService';
import { MEMORY_PROPOSALS_CONFIG_KEY, sanitizeProposals, type MemoryProposal } from '@/common/voice/memoryProposal';
import { acceptMemoryProposal, refuseMemoryProposal } from '@renderer/services/voice/session/voiceMemoryStore';

/**
 * What the assistant thinks it learned, waiting to be agreed with.
 *
 * The memory used to grow only when a model decided, mid-sentence, to call the
 * tool that writes to it — which a small local model almost never does. So an
 * assistant that had a memory did not visibly use it: the same stranger every
 * evening, with a list of session lines behind it and nothing about the person.
 *
 * A conversation is now read back when it ends, and what it suggests lands
 * here. Two properties matter more than the feature does:
 *
 * **Nothing is written without a yes.** The most damaging thing a memory can do
 * is be confidently wrong about somebody, and a model that has decided it
 * learned something is exactly as confident when it is wrong.
 *
 * **Every line shows what it came from.** A claim the user cannot trace is one
 * they cannot argue with, and one they cannot argue with quietly becomes true.
 * The evidence is their own sentence, quoted, in the language they said it in.
 */
const ProposalList: React.FC = () => {
  const { t } = useTranslation();
  const [proposals, setProposals] = useState<MemoryProposal[]>(() =>
    sanitizeProposals(configService.get(MEMORY_PROPOSALS_CONFIG_KEY))
  );
  const [busy, setBusy] = useState('');

  useEffect(
    () => configService.subscribe(MEMORY_PROPOSALS_CONFIG_KEY, (stored) => setProposals(sanitizeProposals(stored))),
    []
  );

  const decide = useCallback(async (proposal: MemoryProposal, keep: boolean) => {
    setBusy(proposal.line);
    try {
      await (keep ? acceptMemoryProposal(proposal) : refuseMemoryProposal(proposal));
    } finally {
      setBusy('');
    }
  }, []);

  // Nothing to agree with is the usual state, and it should take up no room.
  if (proposals.length === 0) return null;

  return (
    <section className='grid gap-8px rounded-12px bg-fill-1 px-14px py-12px'>
      <div className='grid gap-2px'>
        <Typography.Text className='text-13px font-600 text-t-primary'>
          {t('settings.memory.learned.title')}
        </Typography.Text>
        <Typography.Text className='text-12px leading-18px text-t-tertiary'>
          {t('settings.memory.learned.hint')}
        </Typography.Text>
      </div>

      <div className='grid gap-10px'>
        {proposals.map((proposal) => (
          <div key={proposal.line} className='grid gap-6px rounded-10px bg-fill-2 px-12px py-10px'>
            <Typography.Text className='text-13px leading-20px text-t-primary'>{proposal.line}</Typography.Text>
            {/* Quoted rather than summarised: a paraphrase of the evidence is
                one more thing the user has to take on trust. */}
            <Typography.Text className='text-12px leading-18px text-t-tertiary'>
              {t('settings.memory.learned.evidence')} “{proposal.evidence}”
            </Typography.Text>
            <div className='flex gap-8px pt-2px'>
              <Button
                size='mini'
                type='primary'
                loading={busy === proposal.line}
                onClick={() => void decide(proposal, true)}
              >
                {t('settings.memory.learned.accept')}
              </Button>
              <Button size='mini' disabled={busy === proposal.line} onClick={() => void decide(proposal, false)}>
                {t('settings.memory.learned.refuse')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default ProposalList;
