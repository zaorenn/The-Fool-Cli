import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spin, Tag, Typography } from '@arco-design/web-react';
import { Check, Code, Connection, Magic, Refresh, RobotOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { emitter } from '@/renderer/utils/emitter';
import { getManagedAgents } from '@/renderer/hooks/agent/useManagedAgents';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { findOnboardingAgent, getOnboardingStatus, type OnboardingProvider } from './welcomeModel';
import styles from './WelcomePage.module.css';

const JESTER_ASSISTANT_ID = 'fool-assistant';

const providerIcon = (provider: OnboardingProvider) =>
  provider === 'codex' ? <Code theme='outline' size={24} /> : <RobotOne theme='outline' size={24} />;

const WelcomePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<OnboardingProvider | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
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

  const handoffToJester = useCallback(
    async (openingMessage: string) => {
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

  const selectProvider = useCallback(
    async (provider: OnboardingProvider) => {
      const agent = findOnboardingAgent(agents, provider);
      const status = getOnboardingStatus(agent);
      setError('');

      if (status === 'connected') {
        await handoffToJester(t('guid.firstRun.openingMessage'));
        return;
      }

      if (agent && status !== 'missing') {
        setChecking(provider);
        try {
          const result = await ipcBridge.acpConversation.checkManagedAgentHealthById.invoke({ id: agent.id });
          if (result.status === 'online') {
            await handoffToJester(t('guid.firstRun.openingMessage'));
            return;
          }
        } catch {
          // The Jester handoff below owns recovery and presents the real CLI output.
        } finally {
          setChecking(null);
        }
      }

      await handoffToJester(
        t('settings.voice.conversationProviderSetupPrompt', {
          provider: provider === 'codex' ? 'Codex' : 'Claude',
        })
      );
    },
    [agents, handoffToJester, t]
  );

  const providerRows = useMemo(
    () =>
      (['codex', 'claude'] as const).map((provider) => {
        const agent = findOnboardingAgent(agents, provider);
        return { provider, agent, status: getOnboardingStatus(agent) };
      }),
    [agents]
  );

  return (
    <main className={styles.page} data-testid='first-run-welcome'>
      <div className='mx-auto flex min-h-full max-w-980px flex-col justify-center px-24px py-44px'>
        <div className='mb-34px text-center'>
          <div className='mx-auto mb-16px flex size-52px items-center justify-center rounded-16px bg-primary-2 text-primary-6'>
            <Magic theme='filled' size={26} />
          </div>
          <Typography.Title heading={2} className='!mb-8px !text-t-primary'>
            {t('settings.voice.conversationWelcomeTitle')}
          </Typography.Title>
          <Typography.Paragraph className='mx-auto !mb-0 max-w-650px !text-14px !leading-23px !text-t-secondary'>
            {t('settings.voice.conversationWelcomeSubtitle')}
          </Typography.Paragraph>
        </div>

        {error ? <Alert type='error' content={error} className='mb-16px' /> : null}

        {loading ? (
          <div className='flex h-280px items-center justify-center'>
            <Spin size={28} />
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-16px max-[720px]:grid-cols-1'>
            {providerRows.map(({ provider, status }) => {
              const connected = status === 'connected';
              const busy = checking === provider;
              return (
                <section key={provider} className={`${styles.providerCard} rounded-18px p-20px`}>
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
                      type={connected ? 'outline' : 'primary'}
                      size='large'
                      loading={busy}
                      icon={connected ? <Check size={15} /> : <Connection size={15} />}
                      onClick={() => void selectProvider(provider).catch((cause: unknown) => setError(String(cause)))}
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
        )}

        <div className='mt-22px flex flex-wrap items-center justify-center gap-10px'>
          <Button type='text' icon={<Refresh size={14} />} onClick={() => void refresh()}>
            {t('settings.voice.conversationCheckAgain')}
          </Button>
          <Button
            type='text'
            icon={<Magic size={14} />}
            onClick={() => void handoffToJester(t('guid.firstRun.openingMessage'))}
          >
            {t('settings.voice.conversationSetupWithJester')}
          </Button>
        </div>

        <Typography.Text className='mt-14px text-center text-11px leading-17px text-t-tertiary'>
          {t('settings.voice.conversationOauthNotice')}
        </Typography.Text>
      </div>
    </main>
  );
};

export default WelcomePage;
