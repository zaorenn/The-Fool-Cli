/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tabs, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { writeMemoryDoc } from '@renderer/services/voice/session/voiceMemoryStore';
import LocalSkillList from './LocalSkillList';
import MemoryDocEditor from './MemoryDocEditor';
import ProposalList from './ProposalList';
import { useMemoryDocs } from './useMemoryDocs';

/**
 * Everything The Fool remembers, in the two files it remembers it in.
 *
 * The memory used to be invisible. It was there and it worked, and the only way
 * to find out what was in it was to ask out loud and hope the answer was not
 * invented — which for a memory is the worst possible property, because the one
 * thing a person needs to be able to do with something a machine believes about
 * them is read it and cross it out.
 *
 * So they are documents, and this page is the documents. Two of them, because
 * they are different in kind and only one of them is anybody's business but the
 * user's:
 *
 * - **user.md** is about them, and every line of it is theirs to correct.
 * - **agent.md** is the assistant's own working notes — what it got wrong, and
 *   the way of doing things they taught it after it did.
 */

const MemoryModalContent: React.FC = () => {
  const { t } = useTranslation();
  const memory = useMemoryDocs();

  return (
    <div className='grid gap-14px pb-8px'>
      <div className='grid gap-4px'>
        <Typography.Title heading={6} className='!mb-0 !text-t-primary'>
          {t('settings.memory.title')}
        </Typography.Title>
        <Typography.Text className='text-12px leading-19px text-t-tertiary'>
          {t('settings.memory.subtitle')}
        </Typography.Text>
      </div>

      {/* Above the documents rather than inside one of them: this is the only
          thing on the page that is waiting on the user, and a decision hidden
          behind a tab is a decision nobody makes. It renders nothing at all
          when there is nothing to agree with, which is most of the time. */}
      <ProposalList />

      <Tabs defaultActiveTab='user' size='small'>
        <Tabs.TabPane key='user' title={t('settings.memory.userTab')}>
          <MemoryDocEditor
            data-testid='memory-user-doc'
            value={memory.user}
            label={t('settings.memory.userTab')}
            hint={t('settings.memory.userHint')}
            onSave={(text) => writeMemoryDoc('user', text)}
          />
        </Tabs.TabPane>
        <Tabs.TabPane key='agent' title={t('settings.memory.agentTab')}>
          <MemoryDocEditor
            data-testid='memory-agent-doc'
            value={memory.agent}
            label={t('settings.memory.agentTab')}
            hint={t('settings.memory.agentHint')}
            onSave={(text) => writeMemoryDoc('agent', text)}
          />
        </Tabs.TabPane>
        {/* The third kind of thing it remembers, and the only one that acts.
            A skill opens an address or a program when a phrase is said, so it
            belongs where the rest of the memory is read and crossed out — not
            in a place the user has to be told about. */}
        <Tabs.TabPane key='skills' title={t('settings.memory.skillsTab')}>
          <LocalSkillList />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default MemoryModalContent;
