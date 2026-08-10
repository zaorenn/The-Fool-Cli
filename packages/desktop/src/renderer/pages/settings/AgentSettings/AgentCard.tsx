/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Avatar, Button, Message, Switch, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { Delete, EditTwo, Robot } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { connectableAgentForCommand } from '@/common/config/connectableAgents';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { resolveAgentAvatar, useAgentLogos } from '@/renderer/utils/model/agentLogo';
import {
  type AgentManagementStatus,
  type ManagedAgent,
  formatManagedAgentDiagnosticMessage,
} from '@/renderer/utils/model/agentTypes';
import { BoundAssistantStack } from './BoundAssistants';

type AgentCardProps =
  | {
      type: 'official';
      agent: ManagedAgent;
      boundAssistants: Assistant[];
      onTestConnection: () => void;
      onConfigure: () => void;
      isTesting?: boolean;
    }
  | {
      type: 'custom';
      agent: ManagedAgent;
      boundAssistants: Assistant[];
      onTestConnection: () => void;
      onConfigure: () => void;
      isTesting?: boolean;
      onEdit: () => void;
      onDelete: () => void;
      onToggle: (enabled: boolean) => void;
    };

// Card-facing status, finer-grained than the backend's management status:
// the probe reaches `session/new`, so an offline agent that returned
// `auth_required` is "reachable but not signed in" — distinct from a truly
// unreachable agent. We surface that as its own `needs_auth` chip so users
// see "one step away (log in)" vs "broken" vs "not installed".
type DisplayStatus = 'online' | 'needs_auth' | 'offline' | 'missing' | 'unchecked' | 'unknown';

const resolveDisplayStatus = (status?: AgentManagementStatus, errorCode?: string): DisplayStatus => {
  switch (status) {
    case 'online':
      return 'online';
    case 'offline':
      return errorCode === 'auth_required' ? 'needs_auth' : 'offline';
    case 'missing':
      return 'missing';
    case 'unchecked':
      return 'unchecked';
    default:
      return 'unknown';
  }
};

const statusColor = (display: DisplayStatus): 'green' | 'gold' | 'orange' | 'red' | 'gray' => {
  switch (display) {
    case 'online':
      return 'green';
    case 'needs_auth':
      return 'gold';
    case 'offline':
      return 'orange';
    case 'missing':
      return 'red';
    case 'unchecked':
      return 'gray';
    default:
      return 'gray';
  }
};

const statusLabelKey = (display: DisplayStatus) => {
  switch (display) {
    case 'online':
      return 'settings.agentManagement.statusOnline';
    case 'needs_auth':
      return 'settings.agentManagement.statusNeedsAuth';
    case 'offline':
      return 'settings.agentManagement.statusOffline';
    case 'missing':
      return 'settings.agentManagement.statusMissing';
    case 'unchecked':
      return 'settings.agentManagement.statusUnchecked';
    default:
      return 'settings.agentManagement.statusUnknown';
  }
};

/**
 * Single agent row. Clicking anywhere on the row opens the configuration /
 * editor page; inner controls call `stopPropagation` so they don't trigger
 * the row navigation. Official and custom agents share the same row layout;
 * custom agents add an enable switch and a delete action.
 */
const AgentCard: React.FC<AgentCardProps> = (props) => {
  const { t } = useTranslation();
  const logos = useAgentLogos();
  const { agent, boundAssistants, onTestConnection, onConfigure, isTesting } = props;

  const isCustom = props.type === 'custom';
  const isDisabled = isCustom && agent.enabled === false;
  const diagnostics = formatManagedAgentDiagnosticMessage(t, agent);
  const displayStatus = resolveDisplayStatus(agent.status, agent.last_check_error_code);
  const display = displayStatus;

  // Which CLI this row is, if it is one whose sign-in this app knows how to
  // start. Matched on the resolved binary rather than the display name, which
  // is translated and which a custom row can set to anything.
  const signIn = connectableAgentForCommand(agent.agent_source_info?.binary_name || agent.command)?.id ?? null;
  const [signingIn, setSigningIn] = useState(false);

  const startSignIn = useCallback(async () => {
    if (!signIn) return;
    setSigningIn(true);
    try {
      const result = await ipcBridge.application.signInToAgent.invoke({ agentId: signIn });
      Message[result.success ? 'info' : 'error'](
        result.success ? t('settings.setup.signInStarted') : t('settings.setup.signInFallback')
      );
    } catch {
      Message.error(t('settings.setup.signInFallback'));
    } finally {
      setSigningIn(false);
    }
  }, [signIn, t]);

  const avatar = resolveAgentAvatar(logos, {
    icon: agent.avatar || agent.icon,
    backend: agent.backend || agent.agent_type,
    custom_agent_id: agent.custom_agent_id,
    isExtension: agent.isExtension,
  });

  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <div
      data-testid={`agent-row-${agent.id}`}
      className='group flex cursor-pointer items-center justify-between gap-12px rounded-12px border border-solid border-transparent bg-base px-14px py-10px transition-all duration-180 hover:border-border-1 hover:bg-fill-1'
      onClick={onConfigure}
    >
      <div className={`flex min-w-0 flex-1 items-center gap-12px ${isDisabled ? 'opacity-50' : ''}`}>
        <Avatar
          size={32}
          shape='square'
          style={{ flexShrink: 0, backgroundColor: avatar.kind === 'image' ? 'transparent' : 'var(--color-fill-2)' }}
        >
          {avatar.kind === 'image' ? (
            <img src={avatar.value} alt={agent.name} className='h-full w-full object-contain' />
          ) : avatar.kind === 'emoji' ? (
            <span className='text-18px leading-none'>{avatar.value}</span>
          ) : (
            <Robot theme='outline' size='18' />
          )}
        </Avatar>
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-8px'>
            <Typography.Text className='truncate text-14px font-medium text-t-primary'>{agent.name}</Typography.Text>
            <Tag
              data-testid={`agent-row-status-${agent.id}`}
              size='small'
              color={statusColor(displayStatus)}
              className='flex-shrink-0'
            >
              {t(statusLabelKey(displayStatus))}
            </Tag>
            {diagnostics && (
              <Tooltip content={diagnostics}>
                <Typography.Text className='flex-shrink-0 text-11px text-t-secondary'>ⓘ</Typography.Text>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      <div className='ml-12px flex flex-shrink-0 items-center gap-8px' onClick={stop}>
        <BoundAssistantStack assistants={boundAssistants} />
        {/* The row already worked out that this agent is reachable and not
            signed in — and then offered nothing that signs in. "Test" says the
            same thing again and "Edit" opens path and environment overrides,
            which is the one remedy that cannot fix a login: OAuth credentials
            live in the CLI's own config and no environment variable reaches
            them. So the diagnosis stood there with no cure beside it.

            Only for an agent whose sign-in this app actually knows. A custom or
            remote row gets nothing rather than a button that would run the
            wrong command. */}
        {display === 'needs_auth' && signIn ? (
          <Button
            data-testid={`agent-row-signin-${agent.id}`}
            size='small'
            type='primary'
            loading={signingIn}
            onClick={() => void startSignIn()}
            className='!h-30px !rounded-8px !px-10px !text-12px !font-500'
          >
            {t('settings.setup.signInNow')}
          </Button>
        ) : null}
        <Button
          data-testid={`agent-row-test-${agent.id}`}
          size='small'
          type='outline'
          loading={isTesting}
          onClick={onTestConnection}
          className='!h-30px !rounded-8px !border-border-2 !bg-base !px-10px !text-12px !font-500 !text-t-primary hover:!border-border-1 hover:!bg-fill-1'
        >
          {t('settings.agentManagement.testConnection')}
        </Button>
        {/* Both agent kinds get an explicit Edit button that opens the same
            configuration page the whole row links to (status, path/env
            overrides, bound assistants). */}
        <Button
          data-testid={`agent-row-edit-${agent.id}`}
          size='small'
          type='outline'
          onClick={onConfigure}
          className='!h-30px !rounded-8px !border-border-2 !bg-base !px-10px !text-12px !font-500 !text-t-primary hover:!border-border-1 hover:!bg-fill-1'
        >
          {t('common.edit', { defaultValue: 'Edit' })}
        </Button>
        {props.type === 'custom' ? (
          <>
            {/* Custom agents add the definition editor (command/args/env) plus
                enable/delete — controls that have no meaning for built-ins. */}
            <Switch size='small' checked={agent.enabled !== false} onChange={props.onToggle} />
            <Button
              size='small'
              type='outline'
              icon={<EditTwo theme='outline' size='14' />}
              onClick={props.onEdit}
              className='!h-30px !rounded-8px !border-border-2 !bg-base !text-t-primary hover:!border-border-1 hover:!bg-fill-1'
            />
            <Button
              size='small'
              type='outline'
              status='danger'
              icon={<Delete theme='outline' size='14' />}
              onClick={props.onDelete}
              className='!h-30px !rounded-8px !border-danger-2 !bg-base'
            />
          </>
        ) : null}
      </div>
    </div>
  );
};

export default AgentCard;
