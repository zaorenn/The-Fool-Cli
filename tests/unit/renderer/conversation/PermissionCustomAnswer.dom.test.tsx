/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PermissionRequestPanel,
  type PermissionPanelOption,
} from '@/renderer/pages/conversation/Messages/components/MessagePermission';
import { PermissionDock } from '@/renderer/pages/conversation/Messages/components/MessagePermission/PermissionDock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const questionOptions = (): PermissionPanelOption[] => [
  { id: 'a:0', value: 'Postgres', label: 'Postgres', intent: 'neutral', testId: 'message-acp-permission-option-a' },
  { id: 'b:1', value: 'SQLite', label: 'SQLite', intent: 'neutral', testId: 'message-acp-permission-option-b' },
  { id: 'c:2', value: 'MySQL', label: 'MySQL', intent: 'neutral', testId: 'message-acp-permission-option-c' },
];

const renderPanel = (props: Partial<React.ComponentProps<typeof PermissionRequestPanel>> = {}) =>
  render(
    <PermissionRequestPanel
      requestKey='q-1'
      testIdPrefix='message-acp-permission'
      title='Which database?'
      operationKind='tool'
      options={questionOptions()}
      allowCustomAnswer
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />
  );

const pressKey = (key: string, target: EventTarget = window) =>
  act(() => {
    fireEvent.keyDown(target, { key });
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('answering a question in your own words', () => {
  it('offers the free-text choice as the next number after the suggestions', () => {
    renderPanel();

    expect(screen.getByTestId('message-acp-permission-option-custom-key').textContent).toBe('4');
  });

  it('does not offer it on a plain permission request', () => {
    // Prose typed at a shell-command prompt would be forwarded as an approval
    // label and mean nothing.
    renderPanel({ allowCustomAnswer: false });

    expect(screen.queryByTestId('message-acp-permission-option-custom')).toBeNull();
  });

  it('opens the field instead of answering when its number is pressed', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onConfirm });

    await pressKey('4');

    expect(screen.getByTestId('message-acp-permission-custom-input')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('sends what was typed as the answer', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onConfirm });

    await pressKey('4');
    const input = screen.getByTestId('message-acp-permission-custom-input');
    await act(async () => {
      fireEvent.change(input, { target: { value: '  DuckDB  ' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('message-acp-permission-custom-submit'));
    });

    expect(onConfirm).toHaveBeenCalledWith('DuckDB');
  });

  it('refuses to send an empty answer', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onConfirm });

    await pressKey('4');
    const input = screen.getByTestId('message-acp-permission-custom-input');
    await act(async () => {
      fireEvent.change(input, { target: { value: '   ' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('still answers with a listed option when its number is pressed', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onConfirm });

    await pressKey('2');

    expect(onConfirm).toHaveBeenCalledWith('SQLite');
  });
});

describe('where the card is shown', () => {
  it('paints into the dock so scrolling the conversation cannot hide it', () => {
    render(
      <PermissionDock>
        <div data-testid='conversation'>
          <PermissionRequestPanel
            requestKey='q-1'
            testIdPrefix='message-acp-permission'
            title='Which database?'
            operationKind='tool'
            options={questionOptions()}
            onConfirm={vi.fn().mockResolvedValue(undefined)}
          />
        </div>
      </PermissionDock>
    );

    const dock = screen.getByTestId('permission-dock');
    const card = screen.getByTestId('message-acp-permission-card');
    expect(dock.contains(card)).toBe(true);
    expect(screen.getByTestId('conversation').contains(card)).toBe(false);
  });

  it('renders in place when the surface has no dock', () => {
    // Team and preview surfaces have no composer to dock to.
    render(
      <div data-testid='surface'>
        <PermissionRequestPanel
          requestKey='q-1'
          testIdPrefix='message-acp-permission'
          title='Which database?'
          operationKind='tool'
          options={questionOptions()}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
        />
      </div>
    );

    expect(screen.getByTestId('surface').contains(screen.getByTestId('message-acp-permission-card'))).toBe(true);
  });
});
