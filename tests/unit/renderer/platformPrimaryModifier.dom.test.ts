/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which modifier this app's shortcuts answer to.
 *
 * The old test was "the two modifiers differ", which is true of Win+K on Windows
 * and Ctrl+K on a Mac — chords the OS or another application may already own,
 * and neither of them what somebody pressing this app's shortcut is holding.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const isMacOS = vi.fn(() => false);
vi.mock('@/renderer/utils/platform', () => ({ isMacOS: () => isMacOS() }));

import { isPlatformPrimaryModifier, isPrimaryApplicationShortcut } from '@renderer/utils/ui/keyboardShortcuts';

/** A keydown as the app receives one, on a target nothing guards. */
const press = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    composedPath: () => [],
    target: null,
    ...init,
  }) as unknown as KeyboardEvent;

afterEach(() => isMacOS.mockReturnValue(false));

describe('isPlatformPrimaryModifier', () => {
  it('is Control on Windows and Linux', () => {
    expect(isPlatformPrimaryModifier({ ctrlKey: true, metaKey: false })).toBe(true);
  });

  it('is not the Windows key on Windows', () => {
    expect(isPlatformPrimaryModifier({ ctrlKey: false, metaKey: true })).toBe(false);
  });

  it('is Command on macOS', () => {
    isMacOS.mockReturnValue(true);

    expect(isPlatformPrimaryModifier({ ctrlKey: false, metaKey: true })).toBe(true);
  });

  it('is not Control on macOS', () => {
    isMacOS.mockReturnValue(true);

    expect(isPlatformPrimaryModifier({ ctrlKey: true, metaKey: false })).toBe(false);
  });

  it('rejects both held at once on either platform', () => {
    expect(isPlatformPrimaryModifier({ ctrlKey: true, metaKey: true })).toBe(false);
    isMacOS.mockReturnValue(true);
    expect(isPlatformPrimaryModifier({ ctrlKey: true, metaKey: true })).toBe(false);
  });

  it('rejects a bare key', () => {
    expect(isPlatformPrimaryModifier({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});

describe('isPrimaryApplicationShortcut', () => {
  it('matches Ctrl+B on Windows', () => {
    expect(isPrimaryApplicationShortcut(press({ key: 'b', ctrlKey: true }), { key: 'b' })).toBe(true);
  });

  it('does not match Win+B on Windows', () => {
    expect(isPrimaryApplicationShortcut(press({ key: 'b', metaKey: true }), { key: 'b' })).toBe(false);
  });

  it('does not match Ctrl+B on macOS', () => {
    isMacOS.mockReturnValue(true);

    expect(isPrimaryApplicationShortcut(press({ key: 'b', ctrlKey: true }), { key: 'b' })).toBe(false);
  });

  it('still refuses a repeat, an IME composition and an already-handled event', () => {
    expect(isPrimaryApplicationShortcut(press({ key: 'b', ctrlKey: true, repeat: true }), { key: 'b' })).toBe(false);
    expect(isPrimaryApplicationShortcut(press({ key: 'b', ctrlKey: true, isComposing: true }), { key: 'b' })).toBe(
      false
    );
    expect(isPrimaryApplicationShortcut(press({ key: 'b', ctrlKey: true, defaultPrevented: true }), { key: 'b' })).toBe(
      false
    );
  });

  it('honours the shift expectation rather than ignoring it', () => {
    expect(isPrimaryApplicationShortcut(press({ key: 'f', ctrlKey: true, shiftKey: true }), { key: 'f' })).toBe(false);
    expect(
      isPrimaryApplicationShortcut(press({ key: 'f', ctrlKey: true, shiftKey: true }), { key: 'f', shiftKey: true })
    ).toBe(true);
  });
});
