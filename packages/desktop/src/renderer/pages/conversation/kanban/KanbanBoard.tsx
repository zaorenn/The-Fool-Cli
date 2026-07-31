/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, Message, Popconfirm, Select, Spin } from '@arco-design/web-react';
import { Close, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { httpRequest, wsEmitter } from '@/common/adapter/httpBridge';
import type { KanbanBoard as KanbanBoardData, KanbanCard } from '@/common/types/kanban';

/**
 * A project's Kanban board: columns of cards, addable and movable between
 * columns. This is the first, minimal slice — dragging a card, reordering
 * columns, and linking a card to a conversation are follow-on work (see
 * `docs/specs/2026-07-31-project-kanban-design.md` §7 for the fuller UI this
 * is a step toward); moving a card here is a column picker, not a drag.
 *
 * The agent reaches the same board through `foolcore config kanban …`, so a
 * card added here and one added by asking the Jester end up on the same
 * board, and `kanban.boardChanged` keeps both in view live.
 */
export type KanbanBoardProps = {
  projectId: string;
};

const boardPath = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/kanban`;

export const KanbanBoard: React.FC<KanbanBoardProps> = ({ projectId }) => {
  const { t } = useTranslation();
  const [board, setBoard] = useState<KanbanBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    setLoading(true);
    httpRequest<KanbanBoardData>('GET', boardPath(projectId))
      .then(setBoard)
      .catch(() => Message.error(t('kanban.loadFailed')))
      .finally(() => setLoading(false));
  }, [projectId, t]);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => wsEmitter('kanban.boardChanged').on(() => refresh()), [refresh]);

  const addCard = useCallback(
    (columnId: string) => {
      const title = (drafts[columnId] ?? '').trim();
      if (!title) return;
      httpRequest('POST', `${boardPath(projectId)}/cards`, { column_id: columnId, title, body: '' })
        .then(() => {
          setDrafts((previous) => ({ ...previous, [columnId]: '' }));
          refresh();
        })
        .catch(() => Message.error(t('kanban.addCardFailed')));
    },
    [drafts, projectId, refresh, t]
  );

  const moveCard = useCallback(
    (cardId: string, columnId: string) => {
      httpRequest('PATCH', `${boardPath(projectId)}/cards/${encodeURIComponent(cardId)}`, { column_id: columnId })
        .then(refresh)
        .catch(() => Message.error(t('kanban.moveCardFailed')));
    },
    [projectId, refresh]
  );

  const deleteCard = useCallback(
    (cardId: string) => {
      httpRequest('DELETE', `${boardPath(projectId)}/cards/${encodeURIComponent(cardId)}`)
        .then(refresh)
        .catch(() => Message.error(t('kanban.deleteCardFailed')));
    },
    [projectId, refresh, t]
  );

  if (loading && !board) {
    return (
      <div className='flex justify-center py-32px'>
        <Spin />
      </div>
    );
  }

  if (!board) return null;

  return (
    <div className='h-full overflow-x-auto overflow-y-hidden flex gap-12px p-12px' data-kanban-board>
      {board.columns.map((column) => (
        <div
          key={column.column_id}
          data-kanban-column={column.column_id}
          className='flex-shrink-0 w-240px h-full flex flex-col bg-2 rd-12px p-8px'
        >
          <div className='flex items-center justify-between px-4px pb-8px'>
            <div className='text-13px font-[500] text-t-primary'>{column.name}</div>
            <div className='text-12px text-t-tertiary'>{column.cards.length}</div>
          </div>

          <div className='flex-1 overflow-y-auto space-y-8px min-h-0'>
            {column.cards.map((card: KanbanCard) => (
              <div key={card.card_id} data-kanban-card={card.card_id} className='bg-1 rd-8px p-8px space-y-6px'>
                <div className='text-13px text-t-primary break-words'>{card.title}</div>
                <div className='flex items-center gap-6px'>
                  <Select
                    size='mini'
                    value={card.column_id}
                    className='flex-1'
                    onChange={(value: string) => moveCard(card.card_id, value)}
                  >
                    {board.columns.map((target) => (
                      <Select.Option key={target.column_id} value={target.column_id}>
                        {target.name}
                      </Select.Option>
                    ))}
                  </Select>
                  <Popconfirm title={t('kanban.deleteCardConfirm')} onOk={() => deleteCard(card.card_id)}>
                    <Button size='mini' shape='circle' icon={<Close size='12' />} />
                  </Popconfirm>
                </div>
              </div>
            ))}
          </div>

          <div className='flex items-center gap-6px pt-8px'>
            <Input
              size='mini'
              placeholder={t('kanban.addCardPlaceholder')}
              value={drafts[column.column_id] ?? ''}
              onChange={(value) => setDrafts((previous) => ({ ...previous, [column.column_id]: value }))}
              onPressEnter={() => addCard(column.column_id)}
            />
            <Button size='mini' icon={<Plus size='12' />} onClick={() => addCard(column.column_id)} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default KanbanBoard;
