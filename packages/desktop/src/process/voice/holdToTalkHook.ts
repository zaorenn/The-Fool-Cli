/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { TYPING_REPORT_EVERY_MS } from '@/common/voice/thinkingAloud';
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
 * It sees every keystroke on the machine. Nothing is stored and nothing is sent
 * anywhere. Of a key that is not the talk key it asks two questions and no more:
 * whether one arrived at all — the combination rule needs that, never which —
 * and whether it was one of the three digits that answer a permission request,
 * which are read only while a request is actually open.
 */

/** `UiohookKey.CtrlRight`. Hard-coded so the module is not loaded to read it. */
export const RIGHT_CTRL_KEYCODE = 3613;

/**
 * `UiohookKey['1'|'2'|'3']` and their numpad twins, in that order.
 *
 * Hard-coded for the same reason as the talk key. Both rows are here because a
 * request answered from the numpad is the same answer; nothing else about the
 * keys differs.
 */
/**
 * `V`. Held together with the talk key it switches always-on listening off.
 *
 * Watched, never claimed: `RightCtrl+V` is `Ctrl+V`, and paste has to keep
 * working. The hook reports the signal and then abandons the hold like any
 * other combination, so the keystroke reaches the application underneath
 * exactly as it does today.
 */
export const STOP_LISTENING_KEYCODE = 47;

export const CHOICE_KEYCODES: readonly number[] = [2, 3, 4];
export const NUMPAD_CHOICE_KEYCODES: readonly number[] = [79, 80, 81];

/** The 1-based option a keycode stands for, or null if it stands for none. */
export const choiceDigitFor = (keycode: number): number | null => {
  const top = CHOICE_KEYCODES.indexOf(keycode);
  if (top >= 0) return top + 1;
  const pad = NUMPAD_CHOICE_KEYCODES.indexOf(keycode);
  return pad >= 0 ? pad + 1 : null;
};

export type HoldToTalkHookDeps = {
  /** Called with what the machine decided. */
  onEffect: (effect: HoldToTalkEffect) => void;
  /**
   * Called while the user is typing, at most once every
   * {@link TYPING_REPORT_EVERY_MS} and never with anything about the keystroke.
   *
   * The third and last question this hook asks of a key that is not the talk
   * key. It exists because the assistant is not supposed to speak into the
   * middle of a sentence, and a sentence being typed in another window was the
   * one kind it could not see.
   */
  onTyping?: () => void;
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
  /** Zero rather than null: the first keystroke of a session should report. */
  private lastTypingReportAt = 0;

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
      if (event.keycode === this.keycode) {
        report(this.machine.press(Date.now()));
        return;
      }

      // Before the rest, because the questions below can each return and this
      // one is true regardless of what the key turns out to mean. The talk key
      // is excluded above: reaching for the microphone is not typing, and
      // counting it would have the assistant fall silent because somebody was
      // about to talk to it.
      this.reportTyping();
      // V is asked about first, because it can only mean anything while the
      // hold is still live and the abandon below ends it.
      if (event.keycode === STOP_LISTENING_KEYCODE) report(this.machine.stopKeyPressed());

      // Both, in this order: any other key abandons a hold in progress, and a
      // digit answers a pending request. The machine refuses the second when it
      // was holding, so a combination is never also an answer.
      report(this.machine.otherKeyPressed());
      const digit = choiceDigitFor(event.keycode);
      if (digit !== null) report(this.machine.numberKeyPressed(digit));
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

  /**
   * Says "still typing", no more often than the interval allows.
   *
   * The throttle is the privacy boundary as much as it is the performance one:
   * a call per keystroke would carry the rhythm of someone's typing out of this
   * module, and nothing downstream needs more than the fact.
   */
  private reportTyping(): void {
    const onTyping = this.deps.onTyping;
    if (!onTyping) return;

    const now = Date.now();
    if (now - this.lastTypingReportAt < TYPING_REPORT_EVERY_MS) return;

    this.lastTypingReportAt = now;
    onTyping();
  }

  /**
   * How many numbered options are open for an answer, zero when none are.
   *
   * With nothing pending the digits are ordinary typing and the machine has no
   * opinion about them, so this is the switch that keeps the gesture out of the
   * user's way the other 99% of the time.
   */
  public setPendingChoices(count: number): void {
    this.machine.setPendingChoices(count);
  }
}
