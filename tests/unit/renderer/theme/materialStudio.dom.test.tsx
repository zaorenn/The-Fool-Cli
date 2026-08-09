/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

/**
 * The panel opening, and a choice reaching the store.
 *
 * Settings is one page: a component on it that throws while rendering takes the
 * whole surface down, and the symptom — "settings will not open" — says nothing
 * about which of fourteen sections did it. That has happened here once already.
 * So this renders the real thing against the real Arco components, which is the
 * cheap assertion that was missing then.
 *
 * Beyond that it checks the one thing a picker is for: that clicking a material
 * writes it where every window reads it from, rather than onto this page.
 */

const stored: Record<string, unknown> = {};
const setMock = vi.fn(async (key: string, value: unknown) => {
  stored[key] = value;
});

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: (key: string) => stored[key],
    set: setMock,
    subscribe: () => () => undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MaterialStudio = (await import('@renderer/pages/settings/AppearanceSettings/MaterialStudio')).default;

describe('the appearance studio', () => {
  beforeEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
    setMock.mockClear();
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-fool-style');
  });

  it('renders, which is the whole settings page not going down', () => {
    render(<MaterialStudio />);

    expect(screen.getByTestId('material-studio')).toBeTruthy();
  });

  it('offers all seven materials', () => {
    render(<MaterialStudio />);

    for (const id of ['neu', 'glass', 'liquid', 'clay', 'aurora', 'brutal', 'minimal']) {
      expect(screen.getByTestId(`material-${id}`)).toBeTruthy();
    }
  });

  it('shows the derived palette beside the picker, and the real colours', () => {
    render(<MaterialStudio />);

    expect(screen.getByTestId('accent-ramp').children).toHaveLength(5);
  });

  it('stores a chosen material where every window reads it', () => {
    render(<MaterialStudio />);

    fireEvent.click(screen.getByTestId('material-aurora'));

    expect(setMock).toHaveBeenCalledWith('ui.surfaceStyle', expect.objectContaining({ style: 'aurora' }));
  });

  it('wears it immediately, rather than after a restart', () => {
    render(<MaterialStudio />);

    fireEvent.click(screen.getByTestId('material-clay'));

    expect(document.documentElement.getAttribute('data-fool-style')).toBe('clay');
  });

  /// Choosing a colour and choosing a material are two different questions, and
  /// answering one must not answer the other.
  it('keeps the colour when the material changes', () => {
    stored['ui.surfaceStyle'] = { style: 'neu', accent: '#199fd1' };
    render(<MaterialStudio />);

    fireEvent.click(screen.getByTestId('material-brutal'));

    expect(setMock).toHaveBeenCalledWith('ui.surfaceStyle', { style: 'brutal', accent: '#199fd1' });
  });

  it('goes back to what the app ships with', () => {
    stored['ui.surfaceStyle'] = { style: 'aurora', accent: '#8f5fdb', tokens: { depth: 3 } };
    render(<MaterialStudio />);

    fireEvent.click(screen.getByTestId('material-reset'));

    expect(setMock).toHaveBeenCalledWith('ui.surfaceStyle', { style: 'neu', accent: '#e5484d' });
  });
});
