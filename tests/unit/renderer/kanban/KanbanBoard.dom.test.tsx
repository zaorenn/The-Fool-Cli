/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpRequestMock = vi.fn();
const wsListeners = new Map<string, () => void>();

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: (...args: unknown[]) => httpRequestMock(...args),
  wsEmitter: (eventName: string) => ({
    on: (callback: () => void) => {
      wsListeners.set(eventName, callback);
      return () => wsListeners.delete(eventName);
    },
    emit: () => {},
  }),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, icon, ...props }: React.ComponentProps<'button'> & { icon?: React.ReactNode }) => (
    <button onClick={onClick} {...props}>
      {icon}
      {children}
    </button>
  ),
  Input: ({
    value,
    onChange,
    onPressEnter,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    onPressEnter?: () => void;
    placeholder?: string;
  }) => (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onPressEnter?.()}
    />
  ),
  Select: Object.assign(
    ({
      value,
      onChange,
      children,
    }: {
      value: string;
      onChange: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    ),
    {
      Option: ({ value, children }: { value: string; children: React.ReactNode }) => (
        <option value={value}>{children}</option>
      ),
    }
  ),
  Message: { error: vi.fn(), info: vi.fn() },
  Spin: () => <div data-testid='spin' />,
  Popconfirm: ({ children, onOk }: { children: React.ReactNode; onOk: () => void }) => (
    <span onClick={onOk}>{children}</span>
  ),
}));

vi.mock('@icon-park/react', () => ({
  Close: () => <span />,
  Plus: () => <span />,
}));

import { KanbanBoard } from '@renderer/pages/conversation/kanban/KanbanBoard';

const board = {
  columns: [
    {
      column_id: 'col-todo',
      name: 'To do',
      order_index: 1024,
      cards: [
        {
          card_id: 'card-1',
          column_id: 'col-todo',
          title: 'Ship the installer',
          body: '',
          order_index: 1024,
          created_at: 1,
          updated_at: 1,
        },
      ],
    },
    { column_id: 'col-doing', name: 'Doing', order_index: 2048, cards: [] },
  ],
};

describe('KanbanBoard', () => {
  beforeEach(() => {
    httpRequestMock.mockReset();
    wsListeners.clear();
    httpRequestMock.mockResolvedValue(board);
  });

  it('renders columns and their cards', async () => {
    render(<KanbanBoard projectId='proj-1' />);

    await waitFor(() => expect(screen.getByText('Ship the installer')).toBeInTheDocument());
    // "To do"/"Doing" also appear as move-target options on the card, so this
    // checks the column header specifically rather than counting text nodes.
    expect(document.querySelector('[data-kanban-column="col-todo"]')).toHaveTextContent('To do');
    expect(document.querySelector('[data-kanban-column="col-doing"]')).toHaveTextContent('Doing');
    expect(httpRequestMock).toHaveBeenCalledWith('GET', '/api/projects/proj-1/kanban');
  });

  it('adds a card to the column it was typed into', async () => {
    render(<KanbanBoard projectId='proj-1' />);
    await waitFor(() => expect(screen.getByText('Ship the installer')).toBeInTheDocument());

    httpRequestMock.mockResolvedValueOnce({ card_id: 'card-2' });
    const inputs = screen.getAllByPlaceholderText('kanban.addCardPlaceholder');
    fireEvent.change(inputs[0], { target: { value: 'New task' } });
    fireEvent.keyDown(inputs[0], { key: 'Enter' });

    await waitFor(() =>
      expect(httpRequestMock).toHaveBeenCalledWith('POST', '/api/projects/proj-1/kanban/cards', {
        column_id: 'col-todo',
        title: 'New task',
        body: '',
      })
    );
  });

  it('moves a card by changing its column select', async () => {
    render(<KanbanBoard projectId='proj-1' />);
    await waitFor(() => expect(screen.getByText('Ship the installer')).toBeInTheDocument());

    httpRequestMock.mockResolvedValueOnce({});
    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'col-doing' } });

    await waitFor(() =>
      expect(httpRequestMock).toHaveBeenCalledWith('PATCH', '/api/projects/proj-1/kanban/cards/card-1', {
        column_id: 'col-doing',
      })
    );
  });

  it('refreshes the board when kanban.boardChanged fires', async () => {
    render(<KanbanBoard projectId='proj-1' />);
    await waitFor(() => expect(httpRequestMock).toHaveBeenCalledTimes(1));

    wsListeners.get('kanban.boardChanged')?.();

    await waitFor(() => expect(httpRequestMock).toHaveBeenCalledTimes(2));
  });
});
