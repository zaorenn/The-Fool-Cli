/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Input, Message, Switch, Tag, Typography } from '@arco-design/web-react';
import { Link, Music } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ISpotifyStatus } from '@/common/adapter/ipcBridge';
import { configService } from '@/common/config/configService';
import {
  answerCapability,
  CONNECTOR_GRANTS_CONFIG_KEY,
  connectorSpec,
  isGranted,
  sanitizeConnectorGrants,
  type ConnectorGrant,
} from '@/common/permissions/connectors';
import { isSpotifyClientId, spotifyRedirectUris } from '@/common/voice/spotifyAuth';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import SettingsPageHeader from './components/SettingsPageHeader';

/**
 * Where the user connects their own accounts, and says what may be done in them.
 *
 * Three things about this page are the point of it, and none of them is the
 * layout.
 *
 * **The sign-in is not here.** Connect opens Spotify's own page in the user's
 * own browser, where their password manager works and the address bar tells them
 * who is asking. This application renders no login form, has no field for a
 * password, and no code path anywhere that types one. If a future service tempts
 * somebody to add one, the answer is the same: open their browser and step back.
 *
 * **The client id is theirs.** There is no id this project could ship honestly —
 * it is not registered with Spotify, and one belonging to whoever built a fork
 * would put every user's playback under somebody else's account. So it is a
 * field, and `docs/guides/spotify.md` is the two minutes it takes to get one. It
 * is not a secret: PKCE is designed around it being public, which is exactly why
 * a *secret* is not asked for and must never be added.
 *
 * **Connected is not the same as allowed.** The switches are per capability, and
 * they are the reason `common/permissions/connectors.ts` exists: a single
 * "connect Spotify" click is how somebody ends up having agreed to let an
 * assistant write to a playlist they have kept for ten years.
 */

const SPOTIFY = 'spotify';

const useGrants = (): [ConnectorGrant[], (next: ConnectorGrant[]) => void] => {
  const [grants, setGrants] = React.useState<ConnectorGrant[]>([]);

  React.useEffect(() => {
    setGrants(sanitizeConnectorGrants(configService.get(CONNECTOR_GRANTS_CONFIG_KEY)));
    return configService.subscribe(CONNECTOR_GRANTS_CONFIG_KEY, (value) => setGrants(sanitizeConnectorGrants(value)));
  }, []);

  const write = React.useCallback((next: ConnectorGrant[]) => {
    setGrants(next);
    void configService.set(CONNECTOR_GRANTS_CONFIG_KEY, next);
  }, []);

  return [grants, write];
};

const ConnectionsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<ISpotifyStatus | null>(null);
  const [clientId, setClientId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [grants, writeGrants] = useGrants();

  const refresh = React.useCallback(async () => {
    const answer = await ipcBridge.spotify.status.invoke();
    if (answer.success !== true || !answer.data) return;
    setStatus(answer.data);
    setClientId(answer.data.clientId);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveClientId = async (): Promise<void> => {
    const wanted = clientId.trim();
    // Refused beside the field rather than in the browser. A mistyped id is
    // otherwise an opaque Spotify error page, several clicks away from the
    // place it could be corrected.
    if (wanted.length > 0 && !isSpotifyClientId(wanted)) {
      Message.error(t('settings.connections.clientIdInvalid'));
      return;
    }

    const answer = await ipcBridge.spotify.setClientId.invoke({ clientId: wanted });
    if (answer.success !== true) {
      Message.error(t('settings.connections.clientIdInvalid'));
      return;
    }
    setStatus(answer.data ?? null);
    Message.success(t('settings.connections.clientIdSaved'));
  };

  const connect = async (): Promise<void> => {
    setBusy(true);
    try {
      // Their browser opens, and from here the application waits. Nothing on
      // this side touches that window.
      const answer = await ipcBridge.spotify.connect.invoke();
      if (answer.success !== true) {
        Message.error(t('settings.connections.connectFailed', { reason: answer.msg ?? '' }));
        return;
      }
      setStatus(answer.data ?? null);
      // Connecting is consent to the two things the sign-in itself asked for and
      // nothing else. Reading the library and writing to it stay off until the
      // user turns them on here.
      let next = answerCapability(grants, { connector: SPOTIFY, capability: 'playback.read' }, true);
      next = answerCapability(next, { connector: SPOTIFY, capability: 'playback.control' }, true);
      writeGrants(next);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    const answer = await ipcBridge.spotify.disconnect.invoke();
    setStatus(answer.data ?? null);
    // Every answer withdrawn with the account. A grant that outlives the
    // connection is a permission nobody remembers giving.
    writeGrants(grants.filter((grant) => grant.connector !== SPOTIFY));
  };

  const capabilities = connectorSpec(SPOTIFY)?.capabilities ?? [];
  const connected = status?.connected === true;

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px'>
        <SettingsPageHeader
          data-testid='connections-header'
          title={t('settings.connections.title')}
          description={t('settings.connections.description')}
        />

        <Card>
          <div className='flex items-center gap-8px mb-8px'>
            <Music theme='outline' size='18' />
            <Typography.Title heading={6} className='!mb-0'>
              {t('settings.connections.spotifyTitle')}
            </Typography.Title>
            <Tag color={connected ? 'green' : undefined}>
              {connected
                ? status?.displayName
                  ? t('settings.connections.connectedAs', { name: status.displayName })
                  : t('settings.connections.connected')
                : t('settings.connections.notConnected')}
            </Tag>
          </div>

          <Typography.Paragraph type='secondary'>{t('settings.connections.spotifyDescription')}</Typography.Paragraph>

          <div className='flex flex-col gap-8px max-w-560px'>
            <Typography.Text>{t('settings.connections.clientIdLabel')}</Typography.Text>
            <Input
              value={clientId}
              onChange={setClientId}
              placeholder={t('settings.connections.clientIdPlaceholder')}
              onBlur={() => void saveClientId()}
            />
            <Typography.Text type='secondary' className='text-12px'>
              {t('settings.connections.clientIdHelp')}
            </Typography.Text>
          </div>

          {/*
           * Shown rather than only documented, because this is the step the
           * sign-in actually fails on. Spotify matches the redirect address
           * exactly against what was registered, and a mismatch surfaces as an
           * error page in the user's browser with our name on it — a long way
           * from the field that would have fixed it.
           */}
          <div className='flex flex-col gap-4px max-w-560px mt-12px'>
            <Typography.Text>{t('settings.connections.redirectTitle')}</Typography.Text>
            {spotifyRedirectUris().map((uri) => (
              <Typography.Text key={uri} code copyable className='text-12px'>
                {uri}
              </Typography.Text>
            ))}
            <Typography.Text type='secondary' className='text-12px'>
              {t('settings.connections.redirectHelp')}
            </Typography.Text>
          </div>

          <div className='flex items-center gap-8px mt-16px'>
            <Button
              type='primary'
              loading={busy}
              disabled={status?.hasClientId !== true}
              icon={<Link theme='outline' size='14' />}
              onClick={() => void connect()}
            >
              {t(connected ? 'settings.connections.reconnect' : 'settings.connections.connect')}
            </Button>
            {connected && <Button onClick={() => void disconnect()}>{t('settings.connections.disconnect')}</Button>}
          </div>

          <Typography.Paragraph type='secondary' className='!mt-12px !mb-0 text-12px'>
            {t('settings.connections.signInNotice')}
          </Typography.Paragraph>

          <div className='mt-16px flex flex-col gap-8px'>
            <Typography.Text>{t('settings.connections.permissionsTitle')}</Typography.Text>
            {capabilities.map((capability) => (
              <div key={capability.id} className='flex items-center justify-between max-w-560px'>
                <Typography.Text type='secondary'>
                  {t(`settings.connections.capability.${capability.id.replace('.', '_')}`)}
                </Typography.Text>
                <Switch
                  checked={isGranted(grants, { connector: SPOTIFY, capability: capability.id })}
                  onChange={(checked) =>
                    writeGrants(answerCapability(grants, { connector: SPOTIFY, capability: capability.id }, checked))
                  }
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default ConnectionsSettings;
