/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const register = vi.fn();
const unregister = vi.fn();
const isRegistered = vi.fn();
const emit = vi.fn();
const onWillQuit = vi.fn();

vi.mock('electron', () => ({
  app: { on: (event: string, handler: () => void) => onWillQuit(event, handler) },
  globalShortcut: {
    register: (accelerator: string, handler: () => void) => register(accelerator, handler),
    unregister: (accelerator: string) => unregister(accelerator),
    isRegistered: (accelerator: string) => isRegistered(accelerator),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: { foolVoice: { pushToTalk: { emit: () => emit() } } },
}));

const { currentVoiceShortcut, disposeVoiceShortcut, handleVoiceShortcut } =
  await import('@process/voice/pushToTalkShortcut');

describe('handleVoiceShortcut', () => {
  beforeEach(() => {
    disposeVoiceShortcut();
    register.mockReset();
    unregister.mockReset();
    isRegistered.mockReset();
    emit.mockReset();
    register.mockReturnValue(true);
    isRegistered.mockReturnValue(false);
  });

  it('claims the key and says so', () => {
    expect(handleVoiceShortcut({ accelerator: 'Control+Alt+V' })).toEqual({
      accelerator: 'Control+Alt+V',
      registered: true,
    });
    expect(register).toHaveBeenCalledWith('Control+Alt+V', expect.any(Function));
    expect(currentVoiceShortcut()).toBe('Control+Alt+V');
  });

  it('raises the press wherever the user was', () => {
    handleVoiceShortcut({ accelerator: 'Control+Alt+V' });

    const [, handler] = register.mock.calls[0] as [string, () => void];
    handler();

    expect(emit).toHaveBeenCalled();
  });

  it('says when something else on the desktop already holds the key', () => {
    isRegistered.mockReturnValue(true);

    expect(handleVoiceShortcut({ accelerator: 'Control+Alt+V' })).toEqual({
      accelerator: 'Control+Alt+V',
      registered: false,
      reason: 'taken',
    });
    // A key silently doing nothing is the failure this exists to prevent.
    expect(currentVoiceShortcut()).toBeNull();
  });

  it('says when the desktop refuses the key without explaining', () => {
    register.mockReturnValue(false);

    expect(handleVoiceShortcut({ accelerator: 'Control+Alt+V' }).reason).toBe('taken');
  });

  it('says when the combination is not one Electron understands', () => {
    register.mockImplementation(() => {
      throw new Error('Invalid accelerator');
    });

    expect(handleVoiceShortcut({ accelerator: 'Nonsense+Nonsense' })).toEqual({
      accelerator: 'Nonsense+Nonsense',
      registered: false,
      reason: 'invalid',
    });
  });

  it('releases the old key before claiming a new one', () => {
    handleVoiceShortcut({ accelerator: 'Control+Alt+V' });
    handleVoiceShortcut({ accelerator: 'Control+Alt+B' });

    expect(unregister).toHaveBeenCalledWith('Control+Alt+V');
    expect(currentVoiceShortcut()).toBe('Control+Alt+B');
  });

  it('does not report our own key as taken when asked for it again', () => {
    handleVoiceShortcut({ accelerator: 'Control+Alt+V' });
    register.mockClear();

    expect(handleVoiceShortcut({ accelerator: 'Control+Alt+V' })).toEqual({
      accelerator: 'Control+Alt+V',
      registered: true,
    });
    expect(register).not.toHaveBeenCalled();
  });

  it('gives the key back when the setting is emptied', () => {
    handleVoiceShortcut({ accelerator: 'Control+Alt+V' });

    expect(handleVoiceShortcut({ accelerator: '' })).toEqual({ accelerator: '', registered: false });
    expect(unregister).toHaveBeenCalledWith('Control+Alt+V');
    expect(currentVoiceShortcut()).toBeNull();
  });

  it('gives the key back on quit, so it does not outlive the app', () => {
    // A global shortcut left registered keeps the key claimed for everyone else.
    expect(onWillQuit).toHaveBeenCalledWith('will-quit', expect.any(Function));
  });
});
