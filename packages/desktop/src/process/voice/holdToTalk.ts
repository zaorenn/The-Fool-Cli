/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hold a key to talk — and only when it is held alone. Tap it twice to point.
 *
 * The rule that makes this usable: right Ctrl is a real modifier that the user
 * still needs. `RightCtrl+C` has to copy. So a turn starts on the key going
 * down, but the moment any other key joins it the turn is abandoned and the
 * combination is left to the application underneath, untouched. Only a press
 * that was released without company ever speaks.
 *
 * The same key carries a second gesture at no cost to the first: two quick taps
 * ask for a region capture. A tap on its own was already discarded as too brief
 * to be speech, so a pair of them was dead input — nothing had to be taken away
 * from the user to give it a meaning.
 *
 * This is the whole decision, kept as a pure state machine with no Electron and
 * no native hook in it, because the interesting part is the sequencing and that
 * is the part worth testing exhaustively. The driver that feeds it real key
 * events is a thin adapter over `uiohook-napi`; it can be swapped, and on a
 * platform where the hook is unavailable this file still behaves.
 *
 * Why a native hook is needed at all: Electron's `globalShortcut` reports the
 * press and never the release, so it cannot express "held" — see
 * `pushToTalkShortcut.ts`, which is the second-press variant that exists today.
 */

import { MAX_NOTCH_CHOICE_KEYS } from '@/common/types/voiceStage';

/** What the machine wants the rest of the app to do. */
export type HoldToTalkEffect =
  /** The key went down alone: open the microphone. */
  | { kind: 'start' }
  /** Released after being held alone: speak the turn. */
  | { kind: 'commit'; heldMs: number }
  /**
   * Abandoned. Either another key joined the hold, or the press was too brief
   * to have been speech.
   */
  | { kind: 'cancel'; reason: 'combination' | 'too-short' }
  /**
   * Tapped twice, quickly. The user wants to point at something on screen
   * rather than talk about it.
   */
  | { kind: 'capture-region' }
  /**
   * A numbered key was pressed while the app was waiting on a permission
   * request. `index` is zero-based, into the options as the notch numbered them.
   */
  | { kind: 'choose-option'; index: number };

export type HoldToTalkOptions = {
  /**
   * Ignore a press shorter than this.
   *
   * A tap on a modifier is almost never someone starting to talk — it is a
   * mistype, or the tail of a shortcut whose other key was already released.
   * Opening the microphone for it puts the notch on screen for nothing.
   */
  minimumHoldMs?: number;
  /**
   * How close two taps have to be to count as one gesture. Zero switches the
   * gesture off, leaving both taps as ordinary misses.
   */
  doubleTapWindowMs?: number;
};

const DEFAULT_MINIMUM_HOLD_MS = 180;
const DEFAULT_DOUBLE_TAP_WINDOW_MS = 400;

type State =
  | { name: 'idle' }
  /** Held with nothing else so far — still a candidate. */
  | { name: 'holding'; since: number }
  /**
   * Held, but something else was pressed. The turn is already abandoned; this
   * state exists so the eventual release does not look like a fresh one.
   */
  | { name: 'abandoned' };

/**
 * Tracks one key's press and release and reports what should happen.
 *
 * Deliberately given the timestamp rather than reading a clock: the caller
 * already has the event's own time, and a machine that cannot be handed a time
 * cannot be tested for the short-press rule without sleeping.
 */
export class HoldToTalk {
  private state: State = { name: 'idle' };
  private readonly minimumHoldMs: number;
  private readonly doubleTapWindowMs: number;
  /**
   * When the last tap-too-short was released, or null if the last thing that
   * happened was anything else.
   *
   * Only a tap can be the first half of a double tap. A spoken turn or an
   * abandoned combination clears this, so the tap that follows either of them
   * starts counting from nothing rather than completing a gesture the user did
   * not make.
   */
  private lastTapAtMs: number | null = null;
  /**
   * How many numbered options are currently answerable, zero when nothing is
   * being asked.
   *
   * The gate that keeps this gesture out of everybody's way: with nothing
   * pending the number keys are ordinary typing and this machine has no opinion
   * about them at all.
   */
  private pendingChoices = 0;

  public constructor(options: HoldToTalkOptions = {}) {
    this.minimumHoldMs = options.minimumHoldMs ?? DEFAULT_MINIMUM_HOLD_MS;
    this.doubleTapWindowMs = options.doubleTapWindowMs ?? DEFAULT_DOUBLE_TAP_WINDOW_MS;
  }

  /** The talk key went down. */
  public press(atMs: number): HoldToTalkEffect | null {
    // A repeat while already held is the keyboard's auto-repeat, not a new
    // press. Treating it as one would restart the turn every 30 ms.
    if (this.state.name !== 'idle') return null;
    this.state = { name: 'holding', since: atMs };
    return { kind: 'start' };
  }

  /**
   * Some other key went down.
   *
   * Called for every key that is not the talk key, whether or not this machine
   * is holding: outside a hold it is nothing, and inside one it is the end of
   * the turn.
   */
  public otherKeyPressed(): HoldToTalkEffect | null {
    if (this.state.name !== 'holding') return null;
    this.state = { name: 'abandoned' };
    return { kind: 'cancel', reason: 'combination' };
  }

  /** The talk key came back up. */
  public release(atMs: number): HoldToTalkEffect | null {
    const state = this.state;
    this.state = { name: 'idle' };

    // The cancel was already reported when the other key arrived; saying it
    // twice would have the caller close a microphone it has already closed.
    if (state.name !== 'holding') {
      this.lastTapAtMs = null;
      return null;
    }

    const heldMs = Math.max(0, atMs - state.since);
    if (heldMs >= this.minimumHoldMs) {
      this.lastTapAtMs = null;
      return { kind: 'commit', heldMs };
    }

    // Too short to be speech — but two of those in quick succession are a
    // deliberate gesture rather than two mistakes.
    const previous = this.lastTapAtMs;
    // Consumed either way, so a third tap opens a new pair instead of
    // completing a second one against the same first half.
    this.lastTapAtMs = atMs;
    if (this.doubleTapWindowMs > 0 && previous !== null && atMs - previous <= this.doubleTapWindowMs) {
      this.lastTapAtMs = null;
      return { kind: 'capture-region' };
    }
    return { kind: 'cancel', reason: 'too-short' };
  }

  /**
   * How many options the app is waiting on an answer to, if any.
   *
   * Anything past {@link MAX_NOTCH_CHOICE_KEYS} is listed without a key: those
   * options exist, they are simply not reachable from the keyboard. Zero — the
   * usual state — leaves the number keys entirely alone.
   */
  public setPendingChoices(count: number): void {
    this.pendingChoices = Math.min(Math.max(0, Math.trunc(count)), MAX_NOTCH_CHOICE_KEYS);
  }

  /**
   * A number key went down. `digit` is 1-based, as it is on the keyboard.
   *
   * Answers only when something is actually being asked, and only when the talk
   * key is not down: `RightCtrl+1` is a combination like any other, and it
   * belongs to whatever the user is typing into, not to us. Returns null the
   * rest of the time, which is nearly always — the caller does nothing with it,
   * and the keystroke goes through untouched.
   */
  public numberKeyPressed(digit: number): HoldToTalkEffect | null {
    if (this.state.name !== 'idle') return null;
    if (!Number.isInteger(digit) || digit < 1 || digit > this.pendingChoices) return null;
    return { kind: 'choose-option', index: digit - 1 };
  }

  /**
   * Forgets any hold in progress, reporting a cancel if one was open.
   *
   * For losing the keyboard entirely — the hook being torn down, the session
   * being locked, the app quitting. Without it a hold whose release never
   * arrives leaves the microphone open for good.
   */
  public abort(): HoldToTalkEffect | null {
    const wasHolding = this.state.name === 'holding';
    this.state = { name: 'idle' };
    this.lastTapAtMs = null;
    return wasHolding ? { kind: 'cancel', reason: 'combination' } : null;
  }

  /** Whether a turn is currently a candidate. Exposed for the driver's guards. */
  public get isHolding(): boolean {
    return this.state.name === 'holding';
  }
}
