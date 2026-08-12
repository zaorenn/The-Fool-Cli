/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Spin, Tag, Typography } from '@arco-design/web-react';
import { Check, Connection, RobotOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { resolveAgentLogo, useAgentLogos, type AgentLogoMap } from '@/renderer/utils/model/agentLogo';
import { ONBOARDING_LIMIT, onboardingChoices, type OnboardingChoice } from './welcomeModel';
import styles from './WelcomePage.module.css';

/**
 * What is already on this machine, offered rather than asked about.
 *
 * The first question every application like this asks is for an API key, and it
 * is the wrong question: most people who open this already have a coding agent
 * installed and signed in. So the page looks first and asks second — what it
 * found is a button, and what it did not find is a button that goes and gets it.
 * Nobody is asked to paste anything they have not already been told they need.
 *
 * It used to look for exactly two, which meant somebody whose machine had Gemini
 * or Cursor on it was shown a screen that had not noticed. Everything the
 * backend resolved is offered now, in the order {@link onboardingChoices}
 * decides, cut to a screenful.
 */

export type AgentStepProps = {
  agents: readonly ManagedAgent[];
  loading: boolean;
  /** Which agent id is being health-checked right now, if any. */
  checking: string | null;
  onChoose: (choice: OnboardingChoice) => void;
};

const statusColor = (status: OnboardingChoice['status']): string =>
  status === 'connected' ? 'green' : status === 'missing' ? 'orange' : 'arcoblue';

/**
 * The agent's own mark, through the same resolver the rest of the app uses.
 *
 * Not `agent.icon` directly: that value comes out of a backend record and may be
 * a local file path or a bare name, and the catalogue is what turns a backend
 * into a logo the browser can load. A neutral mark stands in while the catalogue
 * is still loading and for anything it does not know.
 */
const AgentMark: React.FC<{ agent: ManagedAgent; logos: AgentLogoMap }> = ({ agent, logos }) => {
  const source = resolveAgentLogo(logos, {
    icon: agent.icon,
    backend: agent.backend,
    custom_agent_id: agent.custom_agent_id,
    isExtension: agent.isExtension,
  });
  if (!source) return <RobotOne theme='outline' size={24} />;
  return <img src={source} alt='' className='size-24px object-contain' />;
};

const AgentStep: React.FC<AgentStepProps> = ({ agents, loading, checking, onChoose }) => {
  const { t } = useTranslation();
  const logos = useAgentLogos();

  if (loading) {
    return (
      <div className='flex h-280px items-center justify-center'>
        <Spin size={28} />
      </div>
    );
  }

  const choices = onboardingChoices(agents).slice(0, ONBOARDING_LIMIT);

  if (choices.length === 0) {
    return (
      <div className='flex h-280px items-center justify-center px-24px text-center' data-testid='setup-no-agents'>
        <Typography.Paragraph className='!mb-0 max-w-420px !text-13px !leading-21px !text-t-tertiary'>
          {t('guid.setup.noAgentsFound')}
        </Typography.Paragraph>
      </div>
    );
  }

  return (
    <div className='grid grid-cols-3 gap-14px max-[900px]:grid-cols-2 max-[620px]:grid-cols-1'>
      {choices.map((choice) => {
        const { agent, status } = choice;
        const connected = status === 'connected';
        return (
          <section key={agent.id} className={`fool-surface ${styles.providerCard} rounded-18px p-18px`}>
            <div className={styles.providerGlow} />
            <div className='relative z-1'>
              <div className='mb-14px flex items-start justify-between gap-10px'>
                <div className='flex size-42px items-center justify-center rounded-12px bg-fill-2 text-t-primary'>
                  <AgentMark agent={agent} logos={logos} />
                </div>
                <Tag color={statusColor(status)}>{t(`settings.voice.conversationProviderStatus.${status}`)}</Tag>
              </div>
              <Typography.Title heading={6} className='!mb-6px !text-t-primary'>
                {agent.name}
              </Typography.Title>
              <Typography.Paragraph
                ellipsis={{ rows: 2 }}
                className='!mb-16px min-h-36px !text-12px !leading-18px !text-t-tertiary'
              >
                {agent.description || t('guid.setup.agentNoDescription')}
              </Typography.Paragraph>
              <Button
                long
                data-testid={`setup-provider-${agent.backend}`}
                type={connected ? 'outline' : 'primary'}
                size='default'
                loading={checking === agent.id}
                icon={connected ? <Check size={15} /> : <Connection size={15} />}
                onClick={() => onChoose(choice)}
              >
                {connected
                  ? t('settings.voice.conversationContinueWithJester')
                  : t('settings.voice.conversationConnectProvider', { provider: agent.name })}
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default AgentStep;
