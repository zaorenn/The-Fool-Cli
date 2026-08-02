/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { HoldToTalk, type HoldToTalkEffect, type HoldToTalkOptions } from './holdToTalk';

/**
 * Feeds real keyboard events to {@link HoldToTalk}.
 *
 * The decision lives next door and is tested on its own; everything here is the
 * adapter — which key counts as the talk key, and how the events arrive.
 *
 * `uiohook-napi` rather than Electron's `globalShortcut`, because the shortcut
 * API reports the press and never the release, and "held" cannot be expressed
 * without a release. That makes this a native module: it has to be rebuilt
 * against Electron's ABI like better-sqlite3, and it is loaded lazily and behind
 * a try so a machine where the hook will not load loses hold-to-talk rather than
 * the whole app.
 *
 * It sees every keystroke on the machine. Nothing is stored, nothing is sent
 * anywhere, and the only question asked of a key that is not the talk key is
 * whether one arrived at all — the combination rule needs to know that a key was
 * pressed, never which.
 */

/** `UiohookKey.CtrlRight`. Hard-coded so the module is not loaded to read it. */
export const RIGHT_CTRL_KEYCODE = 3613;

export type HoldToTalkHookDeps = {
  /** Called with what the machine decided. */
  onEffect: (effect: HoldToTalkEffect) => void;
  /** The keycode that starts a turn. Right Ctrl by default. */
  keycode?: number;
  hold?: HoldToTalkOptions;
  /** Swapped in tests; the real one is `uiohook-napi`. */
  loadHook?: () => UiohookLike;
  logWarn?: (message: string, error: unknown) => void;
};

/** The slice of `uIOhook` this uses. */
export type UiohookLike = {
  on: (event: 'keydown' | 'keyup', listener: (event: { keycode: number }) => void) => unknown;
  off?: (event: 'keydown' | 'keyup', listener: (event: { keycode: number }) => void) => unknown;
  start: () => unknown;
  stop: () => unknown;
};

const loadUiohook = (): UiohookLike => {
  // Required rather than imported: this is a native module, and a static import
  // would make the whole main process fail to load on a machine where the
  // binary is missing or built for the wrong ABI.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { uIOhook } = require('uiohook-napi') as { uIOhook: UiohookLike };
  return uIOhook;
};

export class HoldToTalkHook {
  private readonly machine: HoldToTalk;
  private readonly keycode: number;
  private readonly deps: HoldToTalkHookDeps;
  private hook: UiohookLike | null = null;
  private onKeyDown: ((event: { keycode: number }) => void) | null = null;
  private onKeyUp: ((event: { keycode: number }) => void) | null = null;

  public constructor(deps: HoldToTalkHookDeps) {
    this.deps = deps;
    this.keycode = deps.keycode ?? RIGHT_CTRL_KEYCODE;
    this.machine = new HoldToTalk(deps.hold);
  }

  /** Returns false when the hook could not be loaded — never throws. */
  public start(): boolean {
    if (this.hook) return true;

    let hook: UiohookLike;
    try {
      hook = (this.deps.loadHook ?? loadUiohook)();
    } catch (error) {
      this.deps.logWarn?.('[HoldToTalk] the keyboard hook could not be loaded', error);
      return false;
    }

    const report = (effect: HoldToTalkEffect | null): void => {
      if (effect) this.deps.onEffect(effect);
    };

    this.onKeyDown = (event) => {
      if (event.keycode === this.keycode) report(this.machine.press(Date.now()));
      else report(this.machine.otherKeyPressed());
    };
    this.onKeyUp = (event) => {
      if (event.keycode === this.keycode) report(this.machine.release(Date.now()));
    };

    try {
      hook.on('keydown', this.onKeyDown);
      hook.on('keyup', this.onKeyUp);
      hook.start();
    } catch (error) {
      this.deps.logWarn?.('[HoldToTalk] the keyboard hook could not be started', error);
      this.onKeyDown = null;
      this.onKeyUp = null;
      return false;
    }

    this.hook = hook;
    return true;
  }

  /**
   * Stops listening, closing any hold that was open.
   *
   * The cancel matters: a hold whose release can no longer arrive would
   * otherwise leave the microphone open for good.
   */
  public stop(): void {
    const hook = this.hook;
    this.hook = null;
    const pending = this.machine.abort();
    if (pending) this.deps.onEffect(pending);
    if (!hook) return;

    try {
      if (this.onKeyDown) hook.off?.('keydown', this.onKeyDown);
      if (this.onKeyUp) hook.off?.('keyup', this.onKeyUp);
      hook.stop();
    } catch (error) {
      this.deps.logWarn?.('[HoldToTalk] the keyboard hook did not stop cleanly', error);
    }
    this.onKeyDown = null;
    this.onKeyUp = null;
  }

  public get isRunning(): boolean {
    return this.hook !== null;
  }
}
