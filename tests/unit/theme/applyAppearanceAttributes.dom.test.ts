/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two attributes that decide whether the app is dark, and stay together.
 *
 * `data-theme` drives our own tokens, `arco-theme` drives Arco's. The theme is
 * applied while `useTheme` is being imported, which can happen before `<body>`
 * exists — and the old code wrote the first attribute and silently dropped the
 * second, leaving the shell dark and every Arco component light with nothing to
 * put it right.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({ ipcBridge: { theme: { setActive: { invoke: vi.fn() } } } }));
vi.mock('@/common/config/configService', () => ({ configService: { get: vi.fn(), set: vi.fn() } }));
vi.mock('@renderer/theme/builtinThemes', () => ({ BUILTIN_THEMES: [] }));

import { applyTheme } from '@renderer/utils/theme/applyTheme';
import type { Theme } from '@/common/theme/types';

const dark: Theme = {
  id: 'dark',
  name: 'Dark',
  appearance: 'dark',
  builtin: true,
  created_at: 0,
  updated_at: 0,
};

/** A document whose `<body>` has not been parsed yet, as during early boot. */
const documentWithoutBody = (): Document => {
  const listeners: Array<() => void> = [];
  const body: { setAttribute: ReturnType<typeof vi.fn> } = { setAttribute: vi.fn() };
  let bodyParsed = false;

  const fake = {
    documentElement: document.createElement('html'),
    get body() {
      return bodyParsed ? (body as unknown as HTMLElement) : null;
    },
    head: document.createElement('head'),
    getElementById: () => null,
    createElement: (tag: string) => document.createElement(tag),
    addEventListener: (_event: string, handler: () => void) => listeners.push(handler),
    /** Runs what was deferred, the way DOMContentLoaded would. */
    finishParsing: () => {
      bodyParsed = true;
      listeners.forEach((handler) => handler());
    },
    bodyStub: body,
  };

  return fake as unknown as Document & { finishParsing: () => void; bodyStub: typeof body };
};

describe('applyTheme appearance attributes', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.body.removeAttribute('arco-theme');
  });

  it('writes both attributes when the body is already there', () => {
    applyTheme(dark, document);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.body.getAttribute('arco-theme')).toBe('dark');
  });

  it('defers the Arco attribute instead of dropping it when the body is missing', () => {
    const root = documentWithoutBody() as Document & {
      finishParsing: () => void;
      bodyStub: { setAttribute: ReturnType<typeof vi.fn> };
    };

    applyTheme(dark, root);

    expect(root.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(root.bodyStub.setAttribute).not.toHaveBeenCalled();

    root.finishParsing();

    expect(root.bodyStub.setAttribute).toHaveBeenCalledWith('arco-theme', 'dark');
  });

  it('names the palette as well as the appearance, so a stylesheet can dress one theme', () => {
    applyTheme({ ...dark, id: 'jarvis' }, document);

    expect(document.documentElement.getAttribute('data-theme-id')).toBe('jarvis');
  });
});
