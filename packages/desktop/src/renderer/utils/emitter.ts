/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import EventEmitter from 'eventemitter3';
import type { DependencyList } from 'react';
import { useEffect } from 'react';
import type { FileOrFolderItem } from '@/renderer/utils/file/fileTypes';
import type { PreviewContentType } from '@/common/types/office/preview';

export type ReplyQuote = {
  messageId: string;
  content: string;
  position: 'left' | 'right' | 'center' | 'pop';
};

interface EventTypes {
  // The 2nd arg is the target conversation id: only the send box whose
  // conversation matches consumes the event (team renders one send box per
  // member column, so a bare type prefix alone would leak to same-type peers).
  // `undefined` = no target = any same-type box accepts (back-compat).
  'foolrs.selected.file': [Array<string | FileOrFolderItem>, string | undefined];
  'foolrs.selected.file.append': [Array<string | FileOrFolderItem>, string | undefined];
  'foolrs.selected.file.clear': void;
  'foolrs.workspace.refresh': void;
  'acp.selected.file': [Array<string | FileOrFolderItem>, string | undefined];
  'acp.selected.file.append': [Array<string | FileOrFolderItem>, string | undefined];
  'acp.selected.file.clear': void;
  'acp.workspace.refresh': void;
  'codex.selected.file': [Array<string | FileOrFolderItem>, string | undefined];
  'codex.selected.file.append': [Array<string | FileOrFolderItem>, string | undefined];
  'codex.selected.file.clear': void;
  'codex.workspace.refresh': void;
  'chat.history.refresh': void;
  // 会话删除事件 / Conversation deletion event
  'conversation.deleted': [string]; // conversation_id
  // 预览面板事件 / Preview panel events
  'preview.open': [
    {
      content: string;
      contentType: PreviewContentType;
      /**
       * `file_path` is not optional decoration. The viewers that render a real
       * file — PDF, Word, Excel — read the disk and ignore `content`, so an
       * event without it opens a panel that shows the path as if it were the
       * document. The handler already forwards the whole object; only this
       * type was too narrow to say so.
       */
      metadata?: { title?: string; file_name?: string; file_path?: string };
    },
  ];
  // 填充输入框事件 / Fill sendbox input event
  'sendbox.fill': [string]; // prompt text to fill
  'sendbox.reply': [ReplyQuote]; // reply/quote a message
  'sendbox.reply.clear': void; // clear reply quote
}

export const emitter = new EventEmitter<EventTypes>();

export const addEventListener = <T extends EventEmitter.EventNames<EventTypes>>(
  event: T,
  fn: EventEmitter.EventListener<EventTypes, T>
) => {
  emitter.on(event, fn);
  return () => {
    emitter.off(event, fn);
  };
};

export const useAddEventListener = <T extends EventEmitter.EventNames<EventTypes>>(
  event: T,
  fn: EventEmitter.EventListener<EventTypes, T>,
  deps?: DependencyList
) => {
  useEffect(() => {
    return addEventListener(event, fn);
  }, deps || []);
};
