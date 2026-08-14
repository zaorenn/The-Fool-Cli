/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Alert, Button, Message, Tabs, Tag, Typography } from '@arco-design/web-react';
import { Check, CloseOne, FolderOpen, Link, Magic, Microphone, PauseOne, Voice } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { filesFromDrop, sanitizeConversationFiles, type ConversationFile } from '@/common/voice/conversationFiles';
import { useFoolVoiceSettings } from '@renderer/hooks/voice/useFoolVoiceSettings';
import { useSurfaceLayout } from '@renderer/hooks/config/useSurfaceLayout';
import ShimmerText from '@renderer/components/ShimmerText';
import TextToSpeechSection from '@renderer/components/settings/SettingsModal/contents/voice/tts/TextToSpeechSection';
import ConversationHistory from './ConversationHistory';
import ConversationSettings from './ConversationSettings';
import VoiceHudBody from './hud/VoiceHudBody';
import { conversationRuntime } from './runtime/conversationRuntime';
import { useConversation } from './runtime/useConversation';
import VoiceMeter from './VoiceMeter';
import styles from './VoiceConversationPage.module.css';

/**
 * Voice chat: a conversation with a model that hears and speaks directly.
 *
 * The page is deliberately almost empty. What is on screen while someone is
 * talking is the level of their own voice, the sentence being said, and what the
 * agent is doing about it — everything else is a distraction from an interaction
 * that is not visual. The settings sit beside the start button and disappear the
 * moment the conversation begins.
 *
 * It is a view and nothing more. The conversation lives in a module-level
 * runtime, so leaving this tab — to read the chat the assistant just opened, to
 * approve something, to watch the work happen — does not end it, and coming back
 * shows whatever it has been doing meanwhile.
 */

const VoiceConversationPage: React.FC = () => {
  const { t } = useTranslation();
  const { settings, update } = useFoolVoiceSettings();
  const conversation = useConversation();
  const { layout } = useSurfaceLayout('voice');
  const { phase, error, activities, held } = conversation;

  const active = phase !== 'idle';
  const phaseLabel = useMemo(() => t(`settings.voice.conversationPhase.${phase}`), [phase, t]);

  /** Highlighted while something is being dragged over, so the drop is invited. */
  const [over, setOver] = useState(false);

  /**
   * The absolute path of a dropped file, on whichever Electron this is.
   *
   * `File.path` was removed in Electron 32 and this page was still reading it,
   * so on every build since then a drop produced an empty path, the list was
   * filtered away to nothing, and the handler returned before it could even say
   * so. Dropping a document on the conversation did *nothing*, silently.
   *
   * `webUtils.getPathForFile` is the replacement and the preload has exposed it
   * the whole time. The old property is still tried afterwards, because the
   * browser build has no `electronAPI` and there is nothing to lose by asking.
   */
  const pathOf = (file: File): string =>
    window.electronAPI?.getPathForFile?.(file) || (file as File & { path?: string }).path || '';

  /**
   * Handing the assistant a document by dropping it on the window.
   *
   * The alternative was reading a path out loud or sending the agent to find
   * it, and both are worse than the problem.
   */
  const take = (files: readonly ConversationFile[]): void => {
    if (files.length === 0) return;
    conversationRuntime.hold(files);
    const name = files.map((file) => file.name).join(', ');
    // Held either way — the question is only whether this turn's model will be
    // told. A socket provider keeps its prompt on the far side of a socket and
    // cannot be handed anything mid-call, so the file waits for the next one.
    if (conversationRuntime.heldFilesReachTheModel()) {
      Message.info(t('settings.voice.conversationHolding', { name }));
    } else {
      Message.warning(t('settings.voice.conversationCannotHold'));
    }
  };

  const onDrop = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault();
    setOver(false);
    take(filesFromDrop([...(event.dataTransfer?.files ?? [])], pathOf));
  };

  /**
   * The same thing, for somebody who would rather not drag.
   *
   * A drop is the good gesture and it is not always available: the file may be
   * behind a folder the user has to navigate to, and on a laptop trackpad
   * dragging across two windows is genuinely awkward.
   */
  const browse = async (): Promise<void> => {
    const chosen = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile', 'multiSelections'],
    });
    // No name given on purpose: the picker hands back paths, and `sanitize`
    // takes the last segment, which is what a person calls the thing.
    take(sanitizeConversationFiles((chosen ?? []).map((path) => ({ path, directory: false }))));
  };

  return (
    // `fool-page` is inert until a material is chosen, and then this is the
    // ground the whole page is drawn on — aurora's breathing gradient included.
    <main
      className={classNames('fool-page', styles.page, active && styles.active, styles[phase], over && styles.over)}
      data-testid='voice-conversation'
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className='relative z-1 mx-auto flex h-full min-h-0 max-w-1440px flex-col px-24px py-20px'>
        <header className='flex flex-wrap items-center justify-between gap-12px'>
          <div className='flex items-center gap-10px'>
            <div className='flex size-34px items-center justify-center rounded-10px bg-primary-2 text-primary-6'>
              <Voice theme='filled' size={18} />
            </div>
            <div>
              <Typography.Title heading={5} className='!mb-0 !text-t-primary'>
                {t('settings.voice.conversationModeTitle')}
              </Typography.Title>
              <Typography.Text className='text-12px text-t-tertiary'>
                {t('settings.voice.conversationModeSubtitle')}
              </Typography.Text>
            </div>
          </div>
          <div className='flex items-center gap-8px'>
            {active && conversation.providerName ? <Tag size='small'>{conversation.providerName}</Tag> : null}
            <Tag icon={<Link size={13} />} color={active ? 'green' : 'gray'}>
              {phaseLabel}
            </Tag>
          </div>
        </header>

        {error ? (
          <Alert className='mt-16px' type='error' content={error} closable onClose={() => conversation.setError('')} />
        ) : null}

        {/* What the assistant is holding, above whichever shell is drawn.

            Outside the layout branch on purpose: this is the answer to "does it
            actually have my file", and it has to be the same answer in both
            shapes of the page. Held files used to be invisible — the only
            feedback was a toast that vanished, which meant a drop that was
            silently discarded looked exactly like one that worked. */}
        <div className='mt-12px flex flex-wrap items-center gap-8px'>
          <Button size='mini' shape='round' icon={<FolderOpen size={13} />} onClick={() => void browse()}>
            {t('settings.voice.conversationAttach')}
          </Button>
          {held.map((file) => (
            <Tag
              key={file.path}
              size='small'
              closable
              title={file.path}
              onClose={() => conversationRuntime.release(file.path)}
            >
              {file.name}
            </Tag>
          ))}
          {held.length > 0 && !conversation.heldReachesModel ? (
            <Typography.Text className='text-11px text-warning-6'>
              {t('settings.voice.conversationCannotHold')}
            </Typography.Text>
          ) : null}
        </div>

        {/* The page is one of two shapes, chosen per surface and kept in the
            user's own preferences. The instrument is the default and lives here;
            the HUD is its own folder because it is a different composition
            rather than a variant of this one. */}
        {layout.options.shell === 'hud' ? (
          <VoiceHudBody
            conversation={conversation}
            settings={settings}
            onSettingsChange={update}
            options={layout.options}
          />
        ) : (
          <div className='grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] items-center gap-28px max-[920px]:grid-cols-1 max-[920px]:overflow-auto'>
            <section className='flex min-w-0 flex-col items-center justify-center gap-26px py-20px'>
              <div className={styles.meterStage}>
                <div className={styles.telemetry}>
                  <span className={styles.stamp}>{phaseLabel}</span>
                  <span>
                    {conversation.providerName ? <b>{conversation.providerName}</b> : null}
                    {conversation.providerName && settings.tts.modelId ? ' · ' : null}
                    {settings.tts.modelId ? <b>{settings.tts.modelId.replace(/^tts-/, '')}</b> : null}
                  </span>
                </div>
                <VoiceMeter phase={phase} level={conversation.level} label={phaseLabel} />
                <div className={styles.rule} />
              </div>

              {/* Both sides, not whichever spoke last. Showing only the reply left
                the user unable to check what was actually heard — which is the
                first thing you want when an answer looks wrong, and the only way
                to tell a mis-transcription from a bad answer. */}
              <div className='fool-surface fool-body flex min-h-96px w-full max-w-620px flex-col gap-10px'>
                {conversation.userTranscript ? (
                  <p className={styles.heard} data-testid='voice-heard'>
                    {t('settings.voice.conversationYouSaid', { text: conversation.userTranscript })}
                  </p>
                ) : null}
                <p className={styles.said}>
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

              <div className='mt-14px flex flex-wrap items-center justify-center gap-10px'>
                {!active ? (
                  <Button
                    type='primary'
                    size='large'
                    shape='round'
                    icon={<Microphone size={17} />}
                    onClick={() => void conversation.start()}
                  >
                    {t('settings.voice.conversationStart')}
                  </Button>
                ) : (
                  <>
                    <Button shape='round' size='large' icon={<PauseOne size={17} />} onClick={conversation.stop}>
                      {t('settings.voice.conversationStop')}
                    </Button>
                    <Button
                      shape='round'
                      size='large'
                      icon={<CloseOne size={17} />}
                      disabled={phase !== 'speaking'}
                      onClick={conversation.interrupt}
                    >
                      {t('settings.voice.conversationInterrupt')}
                    </Button>
                  </>
                )}
              </div>
            </section>

            <aside className='fool-surface flex min-h-0 flex-col rounded-18px border border-border-2 bg-bg-2/82 p-16px shadow-sm backdrop-blur-xl max-[920px]:mb-24px'>
              {!active ? (
                // Two tabs rather than one long column: who is being talked to is
                // a different decision from what they sound like, and the second
                // is the one with a drop target in it. The voice tab is the same
                // component Settings shows, so a clone made here is the clone
                // there — not a second copy of the same surface.
                <Tabs defaultActiveTab='conversation' size='small' className={styles.settingsTabs}>
                  <Tabs.TabPane key='conversation' title={t('settings.voice.conversation')}>
                    <ConversationSettings settings={settings} disabled={false} onChange={update} />
                  </Tabs.TabPane>
                  <Tabs.TabPane key='voice' title={t('settings.voice.textToSpeech')}>
                    <div className='max-h-460px overflow-y-auto pr-4px'>
                      <TextToSpeechSection settings={settings} onChange={update} />
                    </div>
                  </Tabs.TabPane>
                  {/* Beside the conversation rather than on a page of its own:
                      voice history is something you glance at on the way into
                      talking again, and a separate destination is a place
                      nobody navigates to. */}
                  <Tabs.TabPane key='history' title={t('settings.voice.history')}>
                    <ConversationHistory onResume={(conversation) => conversationRuntime.resume(conversation)} />
                  </Tabs.TabPane>
                </Tabs>
              ) : (
                // Tabs while running too. History used to be offered only when idle,
                // which put it behind ending the conversation — and the first
                // thing anybody wants mid-conversation is what they said last
                // time. A panel you can only reach by stopping is not a panel.
                <Tabs defaultActiveTab='activity' size='small' className={styles.settingsTabs}>
                  <Tabs.TabPane key='activity' title={t('settings.voice.conversationAgentActivity')}>
                    <div className='mb-14px flex items-center justify-between'>
                      <div className='flex items-center gap-8px'>
                        <Magic size={16} className='text-primary-6' />
                        <Typography.Text className='font-600 text-t-primary'>
                          {t('settings.voice.conversationAgentActivity')}
                        </Typography.Text>
                      </div>
                      <Tag size='small'>{activities.length}</Tag>
                    </div>
                    <div
                      className={classNames(styles.timeline, 'min-h-260px flex-1 space-y-8px overflow-y-auto pb-20px')}
                    >
                      {activities.length === 0 ? (
                        <div className='flex h-220px flex-col items-center justify-center text-center text-t-tertiary'>
                          <Magic size={26} className='mb-10px opacity-55' />
                          <Typography.Text className='max-w-230px text-12px leading-19px text-t-tertiary'>
                            {t('settings.voice.conversationActivityEmpty')}
                          </Typography.Text>
                        </div>
                      ) : (
                        activities.map((activity) => (
                          <div key={activity.id} className='flex gap-9px rounded-12px bg-fill-1 px-10px py-10px'>
                            <span className='mt-1px flex size-20px shrink-0 items-center justify-center rounded-full bg-bg-3'>
                              {activity.state === 'completed' ? (
                                <Check size={12} className='text-success-6' />
                              ) : activity.state === 'failed' ? (
                                <CloseOne size={12} className='text-danger-6' />
                              ) : (
                                <span className='size-7px animate-pulse rounded-full bg-primary-6' />
                              )}
                            </span>
                            <div className='min-w-0'>
                              <Typography.Text className='block truncate text-12px font-600 text-t-primary'>
                                {activity.label}
                              </Typography.Text>
                              <Typography.Text className='mt-2px block text-11px leading-17px text-t-tertiary'>
                                {activity.detail}
                              </Typography.Text>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </Tabs.TabPane>
                  <Tabs.TabPane key='history' title={t('settings.voice.history')}>
                    <ConversationHistory onResume={(conversation) => conversationRuntime.resume(conversation)} />
                  </Tabs.TabPane>
                </Tabs>
              )}
            </aside>
          </div>
        )}
      </div>
    </main>
  );
};

export default VoiceConversationPage;
