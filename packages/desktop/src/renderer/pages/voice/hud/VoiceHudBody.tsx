/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@arco-design/web-react';
import { CloseOne, Microphone, PauseOne } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { LayoutOptions } from '@/common/config/surfaceLayouts';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import ShimmerText from '@renderer/components/ShimmerText';
import type { ConversationHandle } from '../runtime/useConversation';
import ConversationSettings from '../ConversationSettings';
import SettingsDrawer from './SettingsDrawer';
import TraceRail from './TraceRail';
import VoiceDial from './VoiceDial';
import styles from './VoiceHud.module.css';

/**
 * The HUD shape of the voice page.
 *
 * The dial in the middle, the agent's work as a trace down the side, and the
 * settings behind a drawer so a conversation has the screen to itself. It is one
 * of the shapes the page can wear rather than a replacement for the other: an
 * update that rearranged someone's screen without being asked is not an
 * improvement however good the new arrangement is.
 */

export type VoiceHudBodyProps = {
  conversation: ConversationHandle;
  settings: FoolVoiceSettings;
  onSettingsChange: (change: (previous: FoolVoiceSettings) => FoolVoiceSettings) => void;
  options: LayoutOptions;
};

/** Minutes and seconds, which is how long a conversation ever is. */
const clock = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

const VoiceHudBody: React.FC<VoiceHudBodyProps> = ({ conversation, settings, onSettingsChange, options }) => {
  const { t } = useTranslation();
  const { phase, activities } = conversation;
  const active = phase !== 'idle';

  const [drawerOpen, setDrawerOpen] = useState(false);

  /**
   * How long this conversation has been going.
   *
   * Counted here rather than in the runtime: it is a thing this shape displays,
   * and a runtime that outlives the page has no business holding a value only
   * one layout draws.
   */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  // A conversation starting is the moment the settings stop being the subject.
  useEffect(() => {
    if (active) setDrawerOpen(false);
  }, [active]);

  const phaseLabel = useMemo(() => t(`settings.voice.conversationPhase.${phase}`), [phase, t]);

  /**
   * Whether the rail is holding the settings rather than the trace.
   *
   * Only before a conversation starts, and only when the layout asks for it: the
   * trace is what the rail is for once there is work to show, and a rail that
   * had to hold both would be the crowded column this shape was drawn to replace.
   */
  const settingsInRail = options.panel === 'inline' && !active;

  const setup = <ConversationSettings settings={settings} disabled={active} onChange={onSettingsChange} />;

  return (
    // `fool-page` and `fool-surface` are inert until a material is chosen, and
    // then this is the page that shows it best: the dial, the two transcripts
    // and the rail are the app at its most characteristic.
    <div
      className={classNames('fool-page', styles.hud, options.density === 'compact' && styles.compact)}
      data-testid='voice-hud'
    >
      <section className={styles.stage}>
        <div className={styles.dialStage}>
          <VoiceDial phase={phase} level={conversation.level} motion={options.motion} label={phaseLabel} />
          <div className={styles.dialCentre}>
            <span className={styles.phase}>{phaseLabel}</span>
            <span className={styles.clock}>{active ? clock(elapsed) : '00:00'}</span>
          </div>
        </div>

        {/* Both sides, not whichever spoke last: checking what was actually heard
            is the first thing you want when an answer looks wrong, and the only
            way to tell a mis-transcription from a bad answer. */}
        <div className={classNames('fool-surface fool-body', styles.said)}>
          {conversation.userTranscript ? (
            <p className={styles.heard} data-testid='voice-heard'>
              {conversation.userTranscript}
            </p>
          ) : null}
          <p className={classNames(styles.reply, !conversation.assistantTranscript && styles.replyWaiting)}>
            {conversation.assistantTranscript ? (
              conversation.assistantTranscript
            ) : phase === 'thinking' ? (
              <ShimmerText>{t('voice.thinking', { defaultValue: 'Thinking...' })}</ShimmerText>
            ) : conversation.userTranscript ? (
              ''
            ) : (
              t('settings.voice.conversationReadyHint')
            )}
          </p>
        </div>

        <div className={styles.controls}>
          {active ? (
            <>
              <Button shape='round' icon={<PauseOne size={15} />} onClick={conversation.stop}>
                {t('settings.voice.conversationStop')}
              </Button>
              <Button
                shape='round'
                icon={<CloseOne size={15} />}
                disabled={phase !== 'speaking'}
                onClick={conversation.interrupt}
              >
                {t('settings.voice.conversationInterrupt')}
              </Button>
            </>
          ) : (
            <Button
              type='primary'
              shape='round'
              icon={<Microphone size={15} />}
              onClick={() => void conversation.start()}
            >
              {t('settings.voice.conversationStart')}
            </Button>
          )}
        </div>
      </section>

      <aside className={classNames('fool-surface', styles.rail)}>
        {settingsInRail ? (
          <>
            <div className={styles.railHead}>
              <span>{t('settings.voice.conversationSetup')}</span>
            </div>
            {/* Scrolls on its own, for the same reason the drawer's body does:
                the controls are taller than a short window. */}
            <div className={styles.railScroll} data-testid='voice-rail-scroll'>
              {setup}
            </div>
          </>
        ) : (
          <>
            <TraceRail activities={activities} />
            <SettingsDrawer open={drawerOpen} onOpen={() => setDrawerOpen(true)} onClose={() => setDrawerOpen(false)}>
              {setup}
            </SettingsDrawer>
          </>
        )}
      </aside>
    </div>
  );
};

export default VoiceHudBody;
