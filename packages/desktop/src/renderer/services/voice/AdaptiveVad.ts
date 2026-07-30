/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FoolVoiceSettings } from '@/common/types/foolVoice';

export type VadEvent = 'idle' | 'calibrating' | 'speech-started' | 'speech' | 'utterance-ended' | 'utterance-truncated';

type VadConfig = FoolVoiceSettings['vad'];

/**
 * Minimum headroom above the ambient floor, so a dead-silent room still needs a
 * real signal rather than tripping on numerical noise.
 */
const MINIMUM_FLOOR = 0.05;

/** How far above the calibrated floor a frame must sit to count as speech. */
const THRESHOLD_SPAN = 2;

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

  /** Discards the current utterance and ambient baseline. */
  public reset(): void {
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
    this.threshold = floor * (1 + THRESHOLD_SPAN * (1 - this.config.sensitivity) + this.config.sensitivity);
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
