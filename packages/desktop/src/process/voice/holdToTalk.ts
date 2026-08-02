/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hold a key to talk — and only when it is held alone.
 *
 * The rule that makes this usable: right Ctrl is a real modifier that the user
 * still needs. `RightCtrl+C` has to copy. So a turn starts on the key going
 * down, but the moment any other key joins it the turn is abandoned and the
 * combination is left to the application underneath, untouched. Only a press
 * that was released without company ever speaks.
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
  | { kind: 'cancel'; reason: 'combination' | 'too-short' };

export type HoldToTalkOptions = {
  /**
   * Ignore a press shorter than this.
   *
   * A tap on a modifier is almost never someone starting to talk — it is a
   * mistype, or the tail of a shortcut whose other key was already released.
   * Opening the microphone for it puts the notch on screen for nothing.
   */
  minimumHoldMs?: number;
};

const DEFAULT_MINIMUM_HOLD_MS = 180;

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

  public constructor(options: HoldToTalkOptions = {}) {
    this.minimumHoldMs = options.minimumHoldMs ?? DEFAULT_MINIMUM_HOLD_MS;
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
    if (state.name !== 'holding') return null;

    const heldMs = Math.max(0, atMs - state.since);
    if (heldMs < this.minimumHoldMs) return { kind: 'cancel', reason: 'too-short' };
    return { kind: 'commit', heldMs };
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
    return wasHolding ? { kind: 'cancel', reason: 'combination' } : null;
  }

  /** Whether a turn is currently a candidate. Exposed for the driver's guards. */
  public get isHolding(): boolean {
    return this.state.name === 'holding';
  }
}
