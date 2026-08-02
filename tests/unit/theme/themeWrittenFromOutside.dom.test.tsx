/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A theme the jester builds is written straight into client preferences with
 * `config settings client put` — the new theme appended to `theme.userThemes`
 * and its id in `theme.activeId`, both in one command. The write succeeded and
 * the window carried on as before: the announcement was applied one key at a
 * time, so the listener that resolves the active id ran while the theme list
 * was still the old one, found no such theme, and fell back to Light. The
 * gallery, meanwhile, read the list once when it opened and never again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import type { Theme } from '@/common/theme/types';

const { wsListeners, wsEmitterMock, publishedThemes, ipcMock } = vi.hoisted(() => {
  const wsListeners = new Map<string, (payload: unknown) => void>();
  const publishedThemes: string[] = [];
  return {
    wsListeners,
    publishedThemes,
    wsEmitterMock: vi.fn((eventName: string) => ({
      on: (callback: (payload: unknown) => void) => {
        wsListeners.set(eventName, callback);
        return () => wsListeners.delete(eventName);
      },
      emit: () => {},
    })),
    ipcMock: {
      theme: {
        setActive: {
          invoke: vi.fn(async (theme: { id: string }) => {
            publishedThemes.push(theme.id);
          }),
        },
        changed: { on: vi.fn(() => () => {}) },
        requestCurrent: { invoke: vi.fn(async () => null) },
      },
      extensions: { getThemes: { invoke: vi.fn(async () => []) } },
    },
  };
});

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, wsEmitter: wsEmitterMock };
});
vi.mock('@/common', () => ({ ipcBridge: ipcMock }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const CHANGED_EVENT = 'settings.clientPreferencesChanged';

const CREATED_THEME: Theme = {
  id: 'midnight-ember',
  name: 'Midnight Ember',
  appearance: 'dark',
  css: ':root { --color-primary: #e2564a; }',
  builtin: false,
  created_at: 1751328000000,
  updated_at: 1751328000000,
};

/** What the preference store holds; the fetch stub reads through to it. */
let stored: Record<string, unknown> = {};

const jsonResponse = (data: unknown) => ({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => ({ data }),
  text: async () => '',
});

/** The backend announces names only; the window re-reads the keys it heard. */
const announceThemeWrite = async (): Promise<void> => {
  stored = { 'theme.activeId': CREATED_THEME.id, 'theme.userThemes': [CREATED_THEME] };
  await act(async () => {
    // Sorted, as the store sends them: the active id arrives first, before the
    // list that gives it a meaning.
    wsListeners.get(CHANGED_EVENT)?.({ keys: ['theme.activeId', 'theme.userThemes'] });
    await new Promise((settle) => setTimeout(settle, 20));
  });
};

const settle = async (): Promise<void> => {
  const { configService } = await import('@/common/config/configService');
  await act(async () => {
    await configService.whenReady();
    await new Promise((done) => setTimeout(done, 20));
  });
};

describe('a theme the config CLI creates and selects in one write', () => {
  beforeEach(async () => {
    vi.resetModules();
    wsListeners.clear();
    publishedThemes.length = 0;
    stored = { 'theme.activeId': 'light', 'theme.userThemes': [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string }) => {
        if ((init?.method ?? 'GET') !== 'GET') return jsonResponse(null);
        const query = String(url).split('?keys=')[1];
        if (!query) return jsonResponse(stored);
        const subset: Record<string, unknown> = {};
        for (const key of decodeURIComponent(query).split(',')) {
          if (key in stored) subset[key] = stored[key];
        }
        return jsonResponse(subset);
      })
    );
    (window as unknown as { __backendPort?: number }).__backendPort = 13400;
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('theme-decoration')?.remove();
    const { configService } = await import('@/common/config/configService');
    configService.reset();
  });

  it('is applied to the window without a restart', async () => {
    const { renderHook } = await import('@testing-library/react');
    const useTheme = (await import('@renderer/hooks/system/useTheme')).default;

    const view = renderHook(() => useTheme());
    await settle();
    await announceThemeWrite();

    expect(view.result.current[0]?.id).toBe(CREATED_THEME.id);
    expect(view.result.current[2]).toBe(CREATED_THEME.id);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('is never announced to the other windows as the Light fallback', async () => {
    const { renderHook } = await import('@testing-library/react');
    const useTheme = (await import('@renderer/hooks/system/useTheme')).default;

    renderHook(() => useTheme());
    await settle();
    publishedThemes.length = 0;
    await announceThemeWrite();

    // The pet windows and the markdown shadow roots do not read config; they
    // wear whatever this relay publishes. Resolving the new id against the old
    // list yielded Light, and every one of them put it on.
    expect(publishedThemes).not.toContain('light');
    expect(publishedThemes.at(-1)).toBe(CREATED_THEME.id);
  });

  it('appears in the appearance gallery while it is open', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { ThemeProvider } = await import('@renderer/hooks/context/ThemeContext');
    const CssThemeSettings = (await import('@renderer/pages/settings/AppearanceSettings/CssThemeSettings')).default;

    render(React.createElement(ThemeProvider, null, React.createElement(CssThemeSettings)));
    await settle();
    expect(screen.queryByText(CREATED_THEME.name)).toBeNull();

    await announceThemeWrite();

    expect(screen.queryByText(CREATED_THEME.name)).not.toBeNull();
  });
});
