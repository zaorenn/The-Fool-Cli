/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Typography } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IMcpServer } from '@/common/config/storage';
import { addonForTool, type WorkspaceAddon } from '@/common/config/workspaceAddon';
import {
  parseAppRequest,
  WORKSPACE_APP_CHANNEL,
  type WorkspaceApp,
  type WorkspaceAppRequest,
} from '@/common/config/workspaceApp';
import { runAgentTask } from '@renderer/services/voice/session/runAgentTask';
import { peekVoiceMemory } from '@renderer/services/voice/session/voiceMemoryStore';
import { peekVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
import { speakText } from '@renderer/services/voice/speakText';
import { getSpeechPlayer } from '@renderer/services/voice/speechPlayer';
import styles from './FoolsHub.module.css';

/**
 * A workspace's own page, running inside The Fool.
 *
 * The page is static and served over loopback; everything it cannot do on its
 * own it asks for here. That is the whole design: an app written from a spoken
 * description gets the user's agent, the user's models and the user's browser
 * rather than shipping a back end of its own — which is also what makes a
 * workspace something you can safely send to somebody.
 *
 * This component is the other side of that bridge, and it is the security
 * boundary. Every message is parsed rather than cast, only five kinds exist, and
 * anything else is dropped without a reply: a page probing for what else it can
 * reach learns nothing from silence.
 */

export type WorkspaceAppPanelProps = {
  app: WorkspaceApp;
  /** Which workspace this belongs to, so stored values cannot collide. */
  workspaceId: string;
  /** The capabilities this workspace declared, which its page may call. */
  addons: readonly WorkspaceAddon[];
};

const WorkspaceAppPanel: React.FC<WorkspaceAppPanelProps> = ({ app, workspaceId, addons }) => {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const serve = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const served = await window.electronAPI?.serveWorkspaceApp?.(app.folder, app.entry);
      if (!served || served.ok === false) {
        setError(t(`hub.appError.${served?.ok === false ? served.reason : 'failed'}`));
        setUrl('');
        return;
      }
      setUrl(served.url);
    } finally {
      setBusy(false);
    }
  }, [app.folder, app.entry, t]);

  useEffect(() => {
    void serve();
    return () => {
      void window.electronAPI?.stopWorkspaceApp?.();
    };
  }, [serve]);

  /**
   * Where an app's small values live.
   *
   * Under the workspace's own id so two apps cannot read each other's, and in
   * `localStorage` rather than in the app's config: this is a page's scratch
   * space, not a setting, and it should not appear anywhere the user reads their
   * own configuration.
   */
  const storageKey = useCallback((key: string) => `fool.workspace.${workspaceId}.${key}`, [workspaceId]);

  const handle = useCallback(
    async (request: WorkspaceAppRequest): Promise<{ ok: boolean; result?: string; error?: string }> => {
      switch (request.kind) {
        case 'ask': {
          const outcome = await runAgentTask({
            request: request.prompt,
            settings: peekVoiceSettings(),
            memory: peekVoiceMemory(),
          });
          // `=== false` rather than a truthiness check: the same form the tool
          // runner uses, and the one that narrows this union.
          if (outcome.ok === false) {
            return {
              ok: false,
              error: t(`settings.voice.conversationTaskError.${outcome.reason}`, { defaultValue: outcome.reason }),
            };
          }
          return { ok: true, result: outcome.summary };
        }
        case 'open':
          await ipcBridge.shell.openExternal.invoke(request.url);
          return { ok: true, result: request.url };
        case 'say':
          // The same player the read-aloud button uses, so an app speaks in the
          // voice the user chose rather than in one of its own.
          await speakText({
            text: request.text,
            settings: peekVoiceSettings(),
            playback: getSpeechPlayer(),
            maxSpokenCharacters: peekVoiceSettings().narrator.maxSpokenCharacters,
          }).catch((): undefined => undefined);
          return { ok: true };
        /**
         * A call into one of this workspace's own addons.
         *
         * The page names a *tool*, never a server and never a command. Which
         * addon that is comes from the workspace, and whether it is installed
         * comes from the app's own list — so the worst a page can do here is
         * name something that is not there and be told so.
         */
        case 'call': {
          const addon = addonForTool(addons, request.tool);
          if (!addon) return { ok: false, error: t('hub.addonUnknownTool', { tool: request.tool }) };

          const servers = await ipcBridge.mcpService.listServers.invoke().catch((): IMcpServer[] => []);
          const server = (servers ?? []).find((entry) => entry.name.trim().toLowerCase() === addon.id);
          if (!server) return { ok: false, error: t('hub.addonNotInstalled', { name: addon.name }) };

          const answer = await ipcBridge.foolVoice.executeMcpTool.invoke({
            version: 1,
            requestId: crypto.randomUUID(),
            payload: { serverId: server.id, toolName: request.tool, args: request.args },
          });

          if (answer.ok === false) return { ok: false, error: answer.error.code };
          return { ok: true, result: JSON.stringify(answer.data.result) };
        }
        case 'store':
          window.localStorage.setItem(storageKey(request.key), request.value);
          return { ok: true };
        case 'recall':
          return { ok: true, result: window.localStorage.getItem(storageKey(request.key)) ?? '' };
        default:
          return { ok: false, error: 'unsupported' };
      }
    },
    [addons, storageKey, t]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      // Only from the page this panel is showing. Any other window posting at
      // us is not the app, whatever its message says it is.
      if (!frame.current || event.source !== frame.current.contentWindow) return;

      const request = parseAppRequest(event.data);
      if (!request) return;

      void handle(request).then((outcome) => {
        frame.current?.contentWindow?.postMessage({ channel: WORKSPACE_APP_CHANNEL, id: request.id, ...outcome }, '*');
      });
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handle]);

  return (
    <section className={styles.appPanel} data-testid='workspace-app'>
      <header className={styles.appHead}>
        <Typography.Text className='text-13px font-600 text-t-primary'>{app.title}</Typography.Text>
        <Button size='mini' type='text' icon={<Refresh size={13} />} loading={busy} onClick={() => void serve()}>
          {t('hub.appReload')}
        </Button>
      </header>

      {error ? (
        <div className={styles.appError}>
          <Typography.Text className='text-12px text-t-tertiary'>{error}</Typography.Text>
        </div>
      ) : (
        <iframe
          ref={frame}
          className={styles.appFrame}
          src={url}
          title={app.title}
          // The page is generated and served over loopback. It gets scripts,
          // because it is an app; it does not get to navigate the top window,
          // open popups, or reach anything else this list does not name.
          sandbox='allow-scripts allow-forms'
          data-testid='workspace-app-frame'
        />
      )}
    </section>
  );
};

export default WorkspaceAppPanel;
