/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FoolVoiceSettings } from '@/common/types/foolVoice';

export type VadEvent = 'idle' | 'calibrating' | 'speech-started' | 'speech' | 'utterance-ended' | 'utterance-truncated';

type VadConfig = FoolVoiceSettings['vad'];

/**
 * Lowest ambient level the calibration will believe.
 *
 * Only a guard against numerical noise in a silent room. It used to be 0.05,
 * which is not a noise floor at all but roughly the level of a speaking voice:
 * multiplied up it put the bar for speech near an RMS of 0.12, so the
 * microphone sat open and heard nothing short of a shout.
 */
const MINIMUM_FLOOR = 0.004;

/**
 * The lowest bar for speech, whatever the room.
 *
 * A dead-silent room calibrates to almost nothing, and a threshold proportional
 * to almost nothing would trip on a fan or a passing car.
 */
const MINIMUM_THRESHOLD = 0.01;

/**
 * How far above the calibrated floor a frame must sit, across the sensitivity
 * range.
 *
 * The two ends are what sensitivity actually moves between; the old formula
 * spanned 3x down to 2x, so turning the setting all the way up barely changed
 * what the detector heard.
 */
const MULTIPLIER_AT_LEAST_SENSITIVE = 4.5;
const MULTIPLIER_AT_MOST_SENSITIVE = 1.3;

/**
 * Energy-based voice activity detection.
 *
 * Pure by design: it consumes an RMS level and a clock reading and returns an
 * event, so the turn logic can be tested without audio hardware or timers.
 */
export class AdaptiveVad {
  private readonly config: VadConfig;

  private calibrationStartMs: number | null = null;
  private ambientSum = 0;
  private ambientCount = 0;
  private threshold: number | null = null;

  private speechStartMs: number | null = null;
  private speechAccumulatedMs = 0;
  private lastAboveMs: number | null = null;
  private lastFrameMs: number | null = null;
  private announcedStart = false;

  constructor(config: VadConfig) {
    this.config = config;
  }

  /**
   * Whether speech is arriving right now.
   *
   * Exposed so the caption strip can draw the live waveform for exactly as long
   * as there is something to draw, rather than guessing from frame levels.
   */
  public isSpeaking(): boolean {
    return this.announcedStart;
  }

  /**
   * Ends the current utterance. The calibrated floor stands.
   *
   * This is called between every turn, and it used to throw the ambient floor
   * away with the utterance — so the next second of audio was measured as
   * "the room". After the wake word that second is the user already talking,
   * which set the floor at speech level and the bar at twice that: the reason
   * a woken session had to be shouted at while the held button heard fine.
   *
   * A turn ending is not the room changing. Use {@link recalibrate} for that.
   */
  public reset(): void {
    this.resetUtterance();
  }

  /** Forgets the room as well, for a new device or a new session. */
  public recalibrate(): void {
    this.calibrationStartMs = null;
    this.ambientSum = 0;
    this.ambientCount = 0;
    this.threshold = null;
    this.resetUtterance();
  }

  public push(rms: number, nowMs: number): VadEvent {
    const previousFrameMs = this.lastFrameMs;
    this.lastFrameMs = nowMs;

    if (this.threshold === null) {
      return this.calibrate(rms, nowMs);
    }

    if (rms >= this.threshold) {
      return this.onLoudFrame(nowMs, previousFrameMs);
    }

    return this.onQuietFrame(nowMs);
  }

  private calibrate(rms: number, nowMs: number): VadEvent {
    this.calibrationStartMs ??= nowMs;
    this.ambientSum += rms;
    this.ambientCount += 1;

    if (nowMs - this.calibrationStartMs < this.config.calibrationMs) return 'calibrating';

    const floor = Math.max(this.ambientSum / this.ambientCount, MINIMUM_FLOOR);
    // A higher sensitivity setting lowers the bar a speaker has to clear.
    const span = MULTIPLIER_AT_LEAST_SENSITIVE - MULTIPLIER_AT_MOST_SENSITIVE;
    const multiplier = MULTIPLIER_AT_LEAST_SENSITIVE - span * this.config.sensitivity;
    this.threshold = Math.max(floor * multiplier, MINIMUM_THRESHOLD);
    return 'calibrating';
  }

  private onLoudFrame(nowMs: number, previousFrameMs: number | null): VadEvent {
    if (this.speechStartMs === null) {
      this.speechStartMs = nowMs;
      this.speechAccumulatedMs = 0;
      this.lastAboveMs = nowMs;
      this.announcedStart = true;
      return 'speech-started';
    }

    this.speechAccumulatedMs += previousFrameMs === null ? 0 : nowMs - previousFrameMs;
    this.lastAboveMs = nowMs;

    if (nowMs - this.speechStartMs >= this.config.maximumUtteranceMs) {
      this.resetUtterance();
      return 'utterance-truncated';
    }

    return this.announcedStart ? 'speech' : 'speech-started';
  }

  private onQuietFrame(nowMs: number): VadEvent {
    if (this.speechStartMs === null || this.lastAboveMs === null) return 'idle';

    if (nowMs - this.lastAboveMs < this.config.silenceMs) return 'speech';

    // The silence window closed. Only a long enough utterance is worth sending;
    // anything shorter was a cough, a door, or a keystroke.
    const wasRealSpeech = this.speechAccumulatedMs >= this.config.minimumSpeechMs;
    this.resetUtterance();
    return wasRealSpeech ? 'utterance-ended' : 'idle';
  }

  private resetUtterance(): void {
    this.speechStartMs = null;
    this.speechAccumulatedMs = 0;
    this.lastAboveMs = null;
    this.announcedStart = false;
  }
}
