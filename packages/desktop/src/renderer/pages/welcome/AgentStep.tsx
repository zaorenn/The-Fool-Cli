/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Spin, Tag, Typography } from '@arco-design/web-react';
import { Check, Code, Connection, RobotOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { findOnboardingAgent, getOnboardingStatus, type OnboardingProvider } from './welcomeModel';
import styles from './WelcomePage.module.css';

/**
 * What is already on this machine, offered rather than asked about.
 *
 * The first question every application like this asks is for an API key, and it
 * is the wrong question: most people who open this already have a coding agent
 * installed and signed in. So the page looks first and asks second — what it
 * found is a button, and what it did not find is a button that goes and gets
 * it. Nobody is asked to paste anything they have not already been told they
 * need.
 */

export type AgentStepProps = {
  agents: readonly ManagedAgent[];
  loading: boolean;
  /** Which provider is being health-checked right now, if any. */
  checking: OnboardingProvider | null;
  onChoose: (provider: OnboardingProvider) => void;
};

const providerIcon = (provider: OnboardingProvider): React.ReactElement =>
  provider === 'codex' ? <Code theme='outline' size={24} /> : <RobotOne theme='outline' size={24} />;

const PROVIDERS: readonly OnboardingProvider[] = ['codex', 'claude'];

const AgentStep: React.FC<AgentStepProps> = ({ agents, loading, checking, onChoose }) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className='flex h-280px items-center justify-center'>
        <Spin size={28} />
      </div>
    );
  }

  return (
    <div className='grid grid-cols-2 gap-16px max-[720px]:grid-cols-1'>
      {PROVIDERS.map((provider) => {
        const status = getOnboardingStatus(findOnboardingAgent(agents, provider));
        const connected = status === 'connected';
        return (
          <section key={provider} className={`fool-surface ${styles.providerCard} rounded-18px p-20px`}>
            <div className={styles.providerGlow} />
            <div className='relative z-1'>
              <div className='mb-18px flex items-start justify-between gap-12px'>
                <div className='flex size-46px items-center justify-center rounded-13px bg-fill-2 text-t-primary'>
                  {providerIcon(provider)}
                </div>
                <Tag color={connected ? 'green' : status === 'missing' ? 'orange' : 'arcoblue'}>
                  {t(`settings.voice.conversationProviderStatus.${status}`)}
                </Tag>
              </div>
              <Typography.Title heading={5} className='!mb-7px !text-t-primary'>
                {provider === 'codex' ? 'Codex' : 'Claude'}
              </Typography.Title>
              <Typography.Paragraph className='!mb-20px min-h-44px !text-12px !leading-19px !text-t-tertiary'>
                {t(`settings.voice.conversationProviderDescription.${provider}`)}
              </Typography.Paragraph>
              <Button
                long
                data-testid={`setup-provider-${provider}`}
                type={connected ? 'outline' : 'primary'}
                size='large'
                loading={checking === provider}
                icon={connected ? <Check size={15} /> : <Connection size={15} />}
                onClick={() => onChoose(provider)}
              >
                {connected
                  ? t('settings.voice.conversationContinueWithJester')
                  : t('settings.voice.conversationConnectProvider', {
                      provider: provider === 'codex' ? 'Codex' : 'Claude',
                    })}
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default AgentStep;
