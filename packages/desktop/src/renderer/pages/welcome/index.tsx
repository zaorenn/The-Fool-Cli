/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Typography } from '@arco-design/web-react';
import { Magic, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { emitter } from '@/renderer/utils/emitter';
import { getManagedAgents } from '@/renderer/hooks/agent/useManagedAgents';
import { isDark, type SurfaceStyleId } from '@/common/theme/surfaceStyle';
import { useSurfaceStyle } from '@renderer/hooks/config/useSurfaceStyle';
// The two controls the settings panel is built from, used here rather than
// copied. They take a value and hand one back and know nothing about either
// page — and a second copy of the material swatches is a second place for the
// seven materials to drift apart.
import AccentPicker from '@renderer/pages/settings/AppearanceSettings/MaterialStudio/AccentPicker';
import MaterialCards from '@renderer/pages/settings/AppearanceSettings/MaterialStudio/MaterialCards';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import AgentStep from './AgentStep';
import { findOnboardingAgent, getOnboardingStatus, type OnboardingProvider } from './welcomeModel';
import styles from './WelcomePage.module.css';

/**
 * Three questions, and then the application.
 *
 * The promise this page has to keep is that somebody is set up and using the
 * thing in about ten clicks. That rules out the usual first run — a key, a
 * model list, a settings tour — and leaves the three answers without which the
 * app cannot be itself: who is doing the thinking, what it is made of, and what
 * colour it is. Everything else has a sensible default and a settings page.
 *
 * The two appearance steps are not decoration. An application that looks like
 * the screenshot on its download page is one somebody else set up; the first
 * thing this one does is ask, which is the same thing it does for the rest of
 * its life — every one of these is a sentence away in conversation afterwards.
 *
 * Skipping is a real answer. It leaves the defaults on rather than a half-made
 * choice: nothing is stored until it is chosen, so a skipped wizard and a fresh
 * install are the same application.
 */

const JESTER_ASSISTANT_ID = 'fool-assistant';

/** What the page promises, and what the counter is measured against. */
const CLICK_BUDGET = 10;

const STEPS = ['agent', 'material', 'colour'] as const;
type Step = (typeof STEPS)[number];

const WelcomePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { choice, tokens, setStyle, setAccent } = useSurfaceStyle();

  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<OnboardingProvider | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState<Step>('agent');
  const [clicks, setClicks] = useState(0);
  /** The agent that was chosen, and whether it still needs connecting. */
  const [picked, setPicked] = useState<{ provider: OnboardingProvider; connected: boolean } | null>(null);

  const count = useCallback(() => setClicks((previous) => previous + 1), []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setAgents(await getManagedAgents());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Hands the rest of the setup to the assistant, in a conversation.
   *
   * Whatever is still missing — a login, an install, a key — is a back and
   * forth, and a wizard is the worst possible place to have one. So the last
   * click of the wizard is the first message of a conversation that already
   * knows what it is for.
   */
  const finish = useCallback(
    async (openingMessage: string): Promise<void> => {
      const conversation = await ipcBridge.conversation.create.invoke({
        name: t('guid.firstRun.conversationName'),
        assistant: { id: JESTER_ASSISTANT_ID, locale: i18n.language },
        extra: {},
      });
      if (!conversation?.id) throw new Error(t('settings.voice.conversationSetupFailed'));
      await configService.setLocal('system.firstRunGreeted', true);
      sessionStorage.setItem(`acp_initial_message_${conversation.id}`, JSON.stringify({ input: openingMessage }));
      emitter.emit('chat.history.refresh');
      await navigate(`/conversation/${conversation.id}`);
    },
    [i18n.language, navigate, t]
  );

  /**
   * Picking an agent, without leaving the wizard.
   *
   * A provider that is already signed in is settled here. One that is not still
   * only takes a click: what it needs is remembered and handed to the assistant
   * at the end, so choosing an agent that is not installed yet does not throw
   * somebody out of a three-step setup into a conversation on step one.
   */
  const choose = useCallback(
    async (provider: OnboardingProvider): Promise<void> => {
      count();
      setError('');
      const agent = findOnboardingAgent(agents, provider);
      const status = getOnboardingStatus(agent);
      let connected = status === 'connected';

      if (!connected && agent && status !== 'missing') {
        setChecking(provider);
        try {
          const result = await ipcBridge.acpConversation.checkManagedAgentHealthById.invoke({ id: agent.id });
          connected = result.status === 'online';
        } catch {
          // The handoff at the end owns recovery and shows the real CLI output.
        } finally {
          setChecking(null);
        }
      }

      setPicked({ provider, connected });
      setStep('material');
    },
    [agents, count]
  );

  /** The message the assistant opens with, given what is still missing. */
  const openingMessage = useCallback((): string => {
    if (picked && !picked.connected) {
      return t('settings.voice.conversationProviderSetupPrompt', {
        provider: picked.provider === 'codex' ? 'Codex' : 'Claude',
      });
    }
    return t('guid.firstRun.openingMessage');
  }, [picked, t]);

  const advance = useCallback((): void => {
    count();
    const at = STEPS.indexOf(step);
    if (at < STEPS.length - 1) {
      setStep(STEPS[at + 1]);
      return;
    }
    void finish(openingMessage()).catch((cause: unknown) => setError(String(cause)));
  }, [count, finish, openingMessage, step]);

  const skip = useCallback((): void => {
    void finish(openingMessage()).catch((cause: unknown) => setError(String(cause)));
  }, [finish, openingMessage]);

  const dark = isDark(choice.style, document.documentElement.getAttribute('data-theme') === 'dark');
  const at = STEPS.indexOf(step);

  return (
    <main className={`fool-page ${styles.page}`} data-testid='first-run-welcome'>
      <div className='mx-auto flex min-h-full max-w-980px flex-col justify-center px-24px py-44px'>
        <div className='mb-26px text-center'>
          <div className='mx-auto mb-16px flex size-52px items-center justify-center rounded-16px bg-primary-2 text-primary-6'>
            <Magic theme='filled' size={26} />
          </div>
          <Typography.Title heading={2} className='!mb-8px !text-t-primary'>
            {step === 'agent'
              ? t('settings.voice.conversationWelcomeTitle')
              : t(`guid.setup.${step === 'material' ? 'materialTitle' : 'colourTitle'}`)}
          </Typography.Title>
          <Typography.Paragraph className='mx-auto !mb-0 max-w-650px !text-14px !leading-23px !text-t-secondary'>
            {step === 'agent'
              ? t('settings.voice.conversationWelcomeSubtitle')
              : t(`guid.setup.${step === 'material' ? 'materialLead' : 'colourLead'}`)}
          </Typography.Paragraph>
        </div>

        <div className='mb-22px flex justify-center gap-6px' aria-hidden='true'>
          {STEPS.map((name, index) => (
            <span
              key={name}
              className={`h-4px w-46px rounded-999px ${index <= at ? 'bg-primary-6' : 'bg-fill-3'}`}
              data-testid={`setup-step-${name}`}
              data-done={index <= at}
            />
          ))}
        </div>

        {error ? <Alert type='error' content={error} className='mb-16px' /> : null}

        {step === 'agent' ? (
          <AgentStep
            agents={agents}
            loading={loading}
            checking={checking}
            onChoose={(provider) => void choose(provider).catch((cause: unknown) => setError(String(cause)))}
          />
        ) : null}

        {step === 'material' ? (
          <MaterialCards
            chosen={choice.style}
            onChoose={(style: SurfaceStyleId) => {
              count();
              void setStyle(style);
            }}
          />
        ) : null}

        {step === 'colour' ? (
          <AccentPicker
            accent={choice.accent}
            style={choice.style}
            dark={dark}
            tint={tokens.tint}
            onChange={(accent) => {
              count();
              void setAccent(accent);
            }}
          />
        ) : null}

        <div className='mt-22px flex flex-wrap items-center justify-center gap-10px'>
          {step === 'agent' ? (
            <Button type='text' icon={<Refresh size={14} />} onClick={() => void refresh()}>
              {t('settings.voice.conversationCheckAgain')}
            </Button>
          ) : (
            <Button type='primary' size='large' data-testid='setup-next' onClick={advance}>
              {step === 'colour' ? t('guid.setup.start') : t('guid.setup.next')}
            </Button>
          )}
          <Button type='text' data-testid='setup-skip' onClick={skip}>
            {t('guid.setup.skip')}
          </Button>
        </div>

        <Typography.Text className='mt-14px text-center text-11px leading-17px text-t-tertiary'>
          {t('guid.setup.clicks', { clicks, budget: CLICK_BUDGET })}
        </Typography.Text>
        <Typography.Text className='mt-6px text-center text-11px leading-17px text-t-tertiary'>
          {step === 'agent' ? t('settings.voice.conversationOauthNotice') : t('guid.setup.changeLater')}
        </Typography.Text>
      </div>
    </main>
  );
};

export default WelcomePage;
