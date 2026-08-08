/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { orderForSetup, type ConnectStep } from '@/common/config/connectableAgents';
import { orderGateways, type GatewayState } from '@/common/config/localGateways';
import { detectSetup, type SetupSnapshot } from '@renderer/services/setup/detectSetup';
import { Button, Message, Spin, Tag, Typography } from '@arco-design/web-react';
import { Copy, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Connecting a model, for somebody who has never done it.
 *
 * Setup used to be a conversation with the built-in agent. That works, and it
 * asks people to describe something they have usually already done — the CLI is
 * installed, the gateway is running, and being asked about it is being asked to
 * do it twice.
 *
 * So this looks first and offers **one action per row**. Never a choice between
 * two: somebody who has not connected a coding agent before cannot rank "sign
 * in" against "install", and being shown both is how a two-click job becomes a
 * support question.
 *
 * Nothing here has a text field. No ports, no URLs, no keys typed by hand —
 * every address the app needs is already in its own tables, and asking a person
 * for `http://127.0.0.1:20128/v1` is asking them to fail silently.
 */

const STEP_TONE: Record<ConnectStep, 'green' | 'orange' | 'gray'> = {
  use: 'green',
  'sign-in': 'orange',
  install: 'gray',
};

const GATEWAY_TONE: Record<GatewayState, 'green' | 'orange' | 'gray'> = {
  ready: 'green',
  'running-empty': 'orange',
  absent: 'gray',
};

/** A command the user runs themselves. Copied, never executed for them. */
const CommandRow: React.FC<{ command: string; label: string }> = ({ command, label }) => {
  const { t } = useTranslation();

  return (
    <div className='mt-8px flex items-center gap-8px rounded-8px bg-fill-2 px-10px py-7px'>
      <code className='min-w-0 flex-1 truncate text-12px text-t-secondary'>{command}</code>
      <Button
        size='mini'
        type='text'
        icon={<Copy size={13} />}
        title={label}
        onClick={() => {
          void navigator.clipboard.writeText(command).then(
            () => Message.success(t('settings.setup.copied')),
            () => Message.error(t('settings.setup.copyFailed'))
          );
        }}
      />
    </div>
  );
};

const SetupPanel: React.FC = () => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  const [looking, setLooking] = useState(true);

  const look = useCallback(async () => {
    setLooking(true);
    try {
      setSnapshot(await detectSetup());
    } finally {
      setLooking(false);
    }
  }, []);

  useEffect(() => {
    void look();
  }, [look]);

  if (looking && !snapshot) {
    return (
      <div className='flex h-180px items-center justify-center'>
        <Spin tip={t('settings.setup.looking')} />
      </div>
    );
  }

  const agents = snapshot ? orderForSetup(snapshot.agents) : [];
  const gateways = snapshot ? orderGateways(snapshot.gateways) : [];

  return (
    <div className='flex flex-col gap-18px'>
      <div className='flex items-center justify-between'>
        <Typography.Text className='text-12px text-t-tertiary'>{t('settings.setup.lede')}</Typography.Text>
        <Button size='mini' type='text' icon={<Refresh size={13} />} loading={looking} onClick={() => void look()}>
          {t('settings.setup.recheck')}
        </Button>
      </div>

      <section>
        <Typography.Text className='mb-8px block text-11px uppercase tracking-wide text-t-tertiary'>
          {t('settings.setup.agentsTitle')}
        </Typography.Text>

        <div className='flex flex-col gap-8px'>
          {agents.map(({ agent, step }) => (
            <div key={agent.id} className='rounded-12px bg-fill-1 px-12px py-10px'>
              <div className='flex items-center gap-8px'>
                <Typography.Text className='flex-1 text-13px font-500 text-t-primary'>{agent.label}</Typography.Text>
                <Tag size='small' color={STEP_TONE[step]}>
                  {t(`settings.setup.step.${step}`)}
                </Tag>
              </div>

              {/* One action, chosen for them. See the note at the top of the file. */}
              {step === 'install' ? <CommandRow command={agent.install} label={t('settings.setup.copy')} /> : null}
              {step === 'sign-in' && agent.signIn ? (
                <CommandRow command={agent.signIn} label={t('settings.setup.copy')} />
              ) : null}
              {step === 'use' ? (
                <Typography.Text className='mt-6px block text-12px text-t-tertiary'>
                  {t('settings.setup.readyHint')}
                </Typography.Text>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <Typography.Text className='mb-8px block text-11px uppercase tracking-wide text-t-tertiary'>
          {t('settings.setup.gatewaysTitle')}
        </Typography.Text>

        <div className='flex flex-col gap-8px'>
          {gateways.map(({ gateway, state }) => (
            <div key={gateway.id} className='rounded-12px bg-fill-1 px-12px py-10px'>
              <div className='flex items-center gap-8px'>
                <Typography.Text className='text-13px font-500 text-t-primary'>{gateway.label}</Typography.Text>
                <Tag size='small' color={GATEWAY_TONE[state]}>
                  {t(`settings.setup.gateway.${state}`)}
                </Tag>
                <span className='flex-1' />
                <Button size='mini' type='text' onClick={() => void ipcBridge.shell.openExternal.invoke(gateway.docs)}>
                  {t('settings.setup.learnMore')}
                </Button>
              </div>
              <Typography.Text className='mt-4px block text-12px text-t-tertiary'>{gateway.what}</Typography.Text>

              {/* The address is never shown as something to type. A gateway that
                  is up with nothing loaded needs "load a model", not "install". */}
              {state === 'absent' ? <CommandRow command={gateway.install} label={t('settings.setup.copy')} /> : null}
              {state === 'running-empty' ? (
                <Typography.Text className='mt-6px block text-12px text-warning'>
                  {t('settings.setup.loadAModel')}
                </Typography.Text>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default SetupPanel;
