/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * JesterDiagnoseButton — the "Ask the Jester" chip mounted next to
 * FeedbackButton on conversation error surfaces. Clicking it must hand a
 * diagnosis prompt containing the error text to the talk-to-jester flow
 * (the same flow behind the report modal's "Solve via chat").
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'settings.talkToJester.prompt.diagnoseChatError') {
        return `diagnose:${String(options?.error)}`;
      }
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

const talkToJesterMock = vi.fn(() => Promise.resolve());
vi.mock('@/renderer/hooks/assistant/useTalkToJester', () => ({
  useTalkToJester: () => talkToJesterMock,
}));

import JesterDiagnoseButton from '@/renderer/components/base/JesterDiagnoseButton';

describe('JesterDiagnoseButton', () => {
  beforeEach(() => {
    talkToJesterMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the solveWithJester label', () => {
    render(<JesterDiagnoseButton errorText='boom' />);
    expect(screen.getByText('settings.talkToJester.solveWithJester')).toBeInTheDocument();
  });

  it('hands the error text to talkToJester inside the diagnosis prompt', async () => {
    const user = userEvent.setup();
    render(<JesterDiagnoseButton errorText='  connection reset  ' />);
    await user.click(screen.getByText('settings.talkToJester.solveWithJester'));

    expect(talkToJesterMock).toHaveBeenCalledTimes(1);
    expect(talkToJesterMock).toHaveBeenCalledWith({ prompt: 'diagnose:connection reset' });
  });

  it('stops click propagation so the surrounding bubble does not react', async () => {
    const user = userEvent.setup();
    const outerClick = vi.fn();
    render(
      <div onClick={outerClick}>
        <JesterDiagnoseButton errorText='boom' />
      </div>
    );
    await user.click(screen.getByText('settings.talkToJester.solveWithJester'));
    expect(outerClick).not.toHaveBeenCalled();
  });
});
