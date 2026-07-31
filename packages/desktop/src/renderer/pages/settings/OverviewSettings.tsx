/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Spin, Tag } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { httpRequest } from '@/common/adapter/httpBridge';
import FoolScrollArea from '@/renderer/components/base/FoolScrollArea';
import { useSettingsViewMode } from '@/renderer/components/settings/SettingsModal/settingsViewContext';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import {
  summarizeCron,
  summarizeMcp,
  summarizeProviders,
  summarizeRunningConversations,
  type ConversationRow,
  type CronJobRow,
  type McpServerRow,
  type ProviderRow,
} from './overviewSignals';

/**
 * The same snapshot `foolcore diagnose overview` hands the Jester when asked
 * "what's wrong" — read here from the same endpoints, so a person looking at
 * Settings sees exactly what the agent would report.
 *
 * Read-only by design: fixing what shows up here means switching to Agents,
 * MCP, or Scheduled Tasks, not editing anything from this page.
 */

type Snapshot = {
  backendReachable: boolean;
  providers: ProviderRow[];
  mcpServers: McpServerRow[];
  cronJobs: CronJobRow[];
  conversations: ConversationRow[];
};

const loadSnapshot = async (): Promise<Snapshot> => {
  const [health, providers, mcpServers, cronJobs, conversations] = await Promise.all([
    httpRequest<unknown>('GET', '/health').then(
      () => true,
      () => false
    ),
    httpRequest<ProviderRow[]>('GET', '/api/providers').catch(() => [] as ProviderRow[]),
    httpRequest<McpServerRow[]>('GET', '/api/mcp/servers').catch(() => [] as McpServerRow[]),
    httpRequest<CronJobRow[]>('GET', '/api/cron/jobs').catch(() => [] as CronJobRow[]),
    httpRequest<{ items: ConversationRow[] }>('GET', '/api/conversations?limit=50')
      .then((response) => response.items)
      .catch(() => [] as ConversationRow[]),
  ]);
  return { backendReachable: health, providers, mcpServers, cronJobs, conversations };
};

const StatusRow: React.FC<{
  ok: boolean;
  okLabel: string;
  /** Providers/MCP/cron: an unmet condition is a fault (orange). Conversations
   * running is merely active, not broken, so it gets a neutral colour instead. */
  activeColor?: string;
  children?: React.ReactNode;
}> = ({ ok, okLabel, activeColor = 'orange', children }) => (
  <div className='flex items-start gap-8px py-8px'>
    <Tag color={ok ? 'green' : activeColor} size='small'>
      {ok ? okLabel : ' '}
    </Tag>
    {!ok && <div className='flex-1 text-13px text-t-secondary'>{children}</div>}
  </div>
);

const Section: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({ title, count, children }) => (
  <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'>
    <div className='flex items-center justify-between'>
      <div className='text-14px font-[500] text-t-primary'>{title}</div>
      <div className='text-12px text-t-tertiary'>{count}</div>
    </div>
    <div className='mt-8px'>{children}</div>
  </div>
);

const OverviewSettings: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setFailed(false);
    loadSnapshot()
      .then(setSnapshot)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => refresh(), [refresh]);

  const providers = snapshot ? summarizeProviders(snapshot.providers) : null;
  const mcp = snapshot ? summarizeMcp(snapshot.mcpServers) : null;
  const cron = snapshot ? summarizeCron(snapshot.cronJobs) : null;
  const running = snapshot ? summarizeRunningConversations(snapshot.conversations) : null;

  return (
    <SettingsPageWrapper>
      <FoolScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          <div className='flex items-center justify-between px-[12px] md:px-[32px]'>
            <div className='text-13px text-t-tertiary'>{t('settings.overview.subtitle')}</div>
            <Button size='mini' icon={<Refresh />} loading={loading} onClick={refresh}>
              {t('settings.overview.refresh')}
            </Button>
          </div>

          {loading && !snapshot && (
            <div className='flex justify-center py-32px'>
              <Spin />
            </div>
          )}

          {failed && !loading && (
            <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px text-13px text-t-secondary'>
              {t('settings.overview.loadFailed')}
            </div>
          )}

          {snapshot && providers && mcp && cron && running && (
            <>
              <Section title={t('settings.overview.sectionProviders')} count={providers.total}>
                <StatusRow ok={providers.unhealthy.length === 0} okLabel={t('settings.overview.providersHealthy')}>
                  {t('settings.overview.providersUnhealthy', { count: providers.unhealthy.length })}
                  <ul className='m-0 mt-4px pl-16px'>
                    {providers.unhealthy.map((entry) => (
                      <li key={`${entry.provider}:${entry.model}`}>
                        {entry.provider} — {entry.model} ({entry.status})
                      </li>
                    ))}
                  </ul>
                </StatusRow>
              </Section>

              <Section title={t('settings.overview.sectionMcp')} count={mcp.total}>
                <StatusRow ok={mcp.enabledButNoTools.length === 0} okLabel={t('settings.overview.mcpHealthy')}>
                  {t('settings.overview.mcpNoTools', { count: mcp.enabledButNoTools.length })}
                  <ul className='m-0 mt-4px pl-16px'>
                    {mcp.enabledButNoTools.map((entry) => (
                      <li key={entry.id}>{entry.name}</li>
                    ))}
                  </ul>
                </StatusRow>
              </Section>

              <Section title={t('settings.overview.sectionCron')} count={cron.total}>
                <StatusRow ok={cron.failing.length === 0} okLabel={t('settings.overview.cronHealthy')}>
                  {t('settings.overview.cronFailing', { count: cron.failing.length })}
                  <ul className='m-0 mt-4px pl-16px'>
                    {cron.failing.map((entry) => (
                      <li key={entry.id}>
                        {entry.name} ({entry.lastStatus})
                      </li>
                    ))}
                  </ul>
                </StatusRow>
              </Section>

              <Section title={t('settings.overview.sectionConversations')} count={running.length}>
                <StatusRow
                  ok={running.length === 0}
                  okLabel={t('settings.overview.conversationsNone')}
                  activeColor='blue'
                >
                  {t('settings.overview.conversationsRunning', { count: running.length })}
                  <ul className='m-0 mt-4px pl-16px'>
                    {running.map((entry) => (
                      <li key={entry.id}>{entry.name}</li>
                    ))}
                  </ul>
                </StatusRow>
              </Section>
            </>
          )}
        </div>
      </FoolScrollArea>
    </SettingsPageWrapper>
  );
};

export default OverviewSettings;
