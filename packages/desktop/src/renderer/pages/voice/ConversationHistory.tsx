/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VoiceConversation } from '@/common/voice/conversationLog';
import {
  forgetAllConversations,
  forgetConversation,
  peekConversations,
  readConversations,
  subscribeConversations,
} from '@renderer/services/voice/session/conversationStore';
import { Button, Empty, Popconfirm, Typography } from '@arco-design/web-react';
import { Delete, PlayOne, Time } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Spoken conversations, kept and readable.
 *
 * A spoken conversation used to leave one summarised line in the memory and
 * nothing else — every launch opened onto an empty page, and there was no way
 * to check what had actually been said or to pick a thread back up. This is the
 * list of them, the transcript of each, and the way back into one.
 *
 * Deliberately a panel beside the conversation rather than a page of its own.
 * Voice history is something you glance at on the way into talking again, and a
 * separate destination is a place nobody navigates to.
 */

type ConversationHistoryProps = {
  /** Opens a new conversation carrying the end of this one. */
  onResume: (conversation: VoiceConversation) => void;
};

const timeLabel = (ms: number, locale: string): string => {
  const when = new Date(ms);
  const today = new Date();
  const sameDay =
    when.getDate() === today.getDate() &&
    when.getMonth() === today.getMonth() &&
    when.getFullYear() === today.getFullYear();

  // The time alone for today, which is the common case and the one where a date
  // is noise; the date as well for anything older.
  return sameDay
    ? when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : when.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const ConversationHistory: React.FC<ConversationHistoryProps> = ({ onResume }) => {
  const { t, i18n } = useTranslation();
  const [conversations, setConversations] = useState<readonly VoiceConversation[]>(
    () => peekConversations().conversations
  );
  /** Which transcript is open. One at a time: this panel is narrow. */
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readConversations().then((log) => {
      if (!cancelled) setConversations(log.conversations);
    });
    const release = subscribeConversations((log) => setConversations(log.conversations));
    return () => {
      cancelled = true;
      release();
    };
  }, []);

  const remove = useCallback((id: string) => {
    setOpenId((current) => (current === id ? null : current));
    void forgetConversation(id);
  }, []);

  if (conversations.length === 0) {
    return (
      <div className='flex h-220px flex-col items-center justify-center text-center'>
        <Empty
          icon={<Time size={26} className='opacity-55' />}
          description={
            <Typography.Text className='max-w-230px text-12px leading-19px text-t-tertiary'>
              {t('settings.voice.historyEmpty')}
            </Typography.Text>
          }
        />
      </div>
    );
  }

  return (
    <div className='flex max-h-460px flex-col gap-8px overflow-y-auto pr-4px'>
      <div className='flex items-center justify-between px-2px pb-2px'>
        <Typography.Text className='text-11px uppercase tracking-wide text-t-tertiary'>
          {t('settings.voice.historyCount', { count: conversations.length })}
        </Typography.Text>
        <Popconfirm
          title={t('settings.voice.historyForgetAllConfirm')}
          onOk={() => void forgetAllConversations()}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
        >
          <Button type='text' size='mini' status='danger'>
            {t('settings.voice.historyForgetAll')}
          </Button>
        </Popconfirm>
      </div>

      {conversations.map((conversation) => {
        const open = openId === conversation.id;
        return (
          <div key={conversation.id} className='rounded-12px bg-fill-1 px-10px py-9px'>
            <div className='flex items-start gap-8px'>
              <button
                type='button'
                className='min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-left'
                onClick={() => setOpenId(open ? null : conversation.id)}
              >
                <Typography.Text className='block truncate text-13px text-t-primary'>
                  {conversation.title || t('settings.voice.historyUntitled')}
                </Typography.Text>
                <Typography.Text className='text-11px text-t-tertiary'>
                  {timeLabel(conversation.startedAtMs, i18n.language)} ·{' '}
                  {t('settings.voice.historyTurns', { count: conversation.turns.length })}
                </Typography.Text>
              </button>
              <Button
                type='text'
                size='mini'
                icon={<PlayOne size={14} />}
                title={t('settings.voice.historyResume')}
                onClick={() => onResume(conversation)}
              />
              <Popconfirm
                title={t('settings.voice.historyForgetConfirm')}
                onOk={() => remove(conversation.id)}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
              >
                <Button type='text' size='mini' status='danger' icon={<Delete size={14} />} />
              </Popconfirm>
            </div>

            {open ? (
              // The whole transcript, both sides. Showing only what the
              // assistant said would leave the reader unable to tell a
              // mis-transcription from a bad answer — the same reason the live
              // page shows both.
              <div className='mt-9px space-y-6px border-t border-border-2 pt-9px'>
                {conversation.turns.map((turn, index) => (
                  <p
                    key={index}
                    className={
                      turn.role === 'user'
                        ? 'm-0 text-12px leading-18px text-t-secondary'
                        : 'm-0 text-12px leading-18px text-t-primary'
                    }
                  >
                    <span className='mr-4px text-t-tertiary'>
                      {turn.role === 'user' ? t('settings.voice.historyYou') : t('settings.voice.historyAssistant')}
                    </span>
                    {turn.text}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default ConversationHistory;
