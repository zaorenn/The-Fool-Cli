/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VoiceSynthesizedWav } from '@/common/types/foolVoice';

/** `setSinkId` on AudioContext is not in every lib.dom version yet. */
type RoutableAudioContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };

export class AudioPlaybackService {
  private audioContext: RoutableAudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private outputDeviceId: string | null = null;
  private routedDeviceId: string | null = null;

  /**
   * Chooses which speaker plays synthesised audio.
   *
   * Without this the picker in Voice settings has no effect — playback always
   * lands on the system default device.
   */
  public setOutputDevice(deviceId: string | null): void {
    this.outputDeviceId = deviceId;
  }

  private async routeToSelectedDevice(context: RoutableAudioContext): Promise<void> {
    const target = this.outputDeviceId;
    if (target === this.routedDeviceId) return;
    if (typeof context.setSinkId !== 'function') return;

    try {
      // An empty string restores the system default.
      await context.setSinkId(target ?? '');
      this.routedDeviceId = target;
    } catch {
      // A device that vanished should degrade to the default, not kill playback.
      this.routedDeviceId = null;
    }
  }

  public async play(audio: VoiceSynthesizedWav): Promise<void> {
    // Deliberately no explicit sampleRate: voices emit different rates (Piper
    // 22.05 kHz, Kokoro 24 kHz) and pinning the context to whichever clip
    // played first would force every later clip through that rate.
    // `decodeAudioData` resamples into the context rate for us.
    this.audioContext ??= new window.AudioContext() as RoutableAudioContext;
    const context = this.audioContext;

    await this.routeToSelectedDevice(context);

    const binaryString = window.atob(audio.dataBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index);
    }
    const audioBuffer = await context.decodeAudioData(bytes.buffer);

    this.stop();

    if (context.state === 'suspended') {
      await context.resume();
    }

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    source.start(0);
    this.currentSource = source;

    return new Promise((resolve) => {
      source.onended = () => {
        if (this.currentSource === source) {
          this.currentSource = null;
        }
        resolve();
      };
    });
  }

  /**
   * Plays a short tone on the selected speaker.
   *
   * Picking a device from a list proves nothing on its own — this is how the
   * user confirms that the device they chose is the one that actually sounds.
   */
  public async playTone(options: { frequencyHz?: number; durationMs?: number; volume?: number } = {}): Promise<void> {
    const { frequencyHz = 440, durationMs = 400, volume = 0.2 } = options;

    this.audioContext ??= new window.AudioContext() as RoutableAudioContext;
    const context = this.audioContext;

    await this.routeToSelectedDevice(context);
    if (context.state === 'suspended') await context.resume();

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequencyHz;
    // Ramped rather than switched, so the tone does not start with a click.
    const now = context.currentTime;
    const endsAt = now + durationMs / 1000;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, volume)), now + 0.02);
    gain.gain.linearRampToValueAtTime(0, endsAt);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(endsAt);

    return new Promise((resolve) => {
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        resolve();
      };
    });
  }

  public stop(): void {
    if (this.currentSource) {
      this.currentSource.stop();
      this.currentSource = null;
    }
  }
}
