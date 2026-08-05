/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The microphone and the speaker, for a conversation that has to feel live.
 *
 * Almost everything here exists because of a specific way a spoken conversation
 * can feel wrong rather than be broken:
 *
 * - The capture runs in an audio worklet, off the main thread. On a
 *   `ScriptProcessorNode` — which is what this used, and what the platform has
 *   been trying to remove for years — a React render lands in the same thread as
 *   the audio callback, and every dropped block is a syllable the model never
 *   hears.
 * - Echo cancellation is on, and it is not optional. Without it the microphone
 *   picks the reply out of the speakers, the provider's turn detection decides
 *   the user has started talking, and the model interrupts itself on every
 *   sentence. It is the single most common reason one of these feels unusable.
 * - Playback keeps one audio context for the whole session and stops sources to
 *   interrupt, rather than closing the context. Closing it cost a fresh device
 *   handshake on the next word — a stall of well over a tenth of a second, with
 *   a click at each end.
 * - Chunks are scheduled a little ahead of the clock rather than at it. The
 *   provider's audio arrives over a network, in bursts; scheduled at
 *   `currentTime` the first one is already late and the speaker crackles through
 *   the start of every reply.
 */

export const float32ToPcm16Base64 = (samples: Float32Array): string => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
  }

  // Built in blocks: one `String.fromCharCode` per byte is a string
  // concatenation per byte, and at fifty of these a second it shows up as jank.
  let binary = '';
  const BLOCK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += BLOCK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BLOCK));
  }
  return btoa(binary);
};

export const pcm16Base64ToFloat32 = (base64: string): Float32Array => {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return samples;
};

/**
 * Linear resampling between the device's rate and the provider's.
 *
 * Good enough on purpose. The alternative is a windowed-sinc filter, and the
 * difference is inaudible once the signal has been through a speech codec and a
 * transcription model — while the cost would be paid on every block, forever.
 * Returns the input untouched when the rates already agree, which is the common
 * case: browsers honour a requested context rate nearly always.
 */
export const resamplePcm = (samples: Float32Array, fromRate: number, toRate: number): Float32Array => {
  if (fromRate === toRate || samples.length === 0) return samples;

  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = position - left;
    output[index] = samples[left] * (1 - weight) + samples[right] * weight;
  }
  return output;
};

/** Root-mean-square level, 0..1, for the waveform the notch and the page draw. */
export const levelOf = (samples: Float32Array): number => {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  // Scaled up because speech sits far below full scale: an honest RMS reading of
  // a person talking at a normal distance barely moves a meter drawn 0..1.
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
};

/**
 * The capture worklet, as source.
 *
 * Inlined and loaded from a blob URL rather than shipped as a file: this app is
 * bundled several different ways — dev server, packaged asar, the web host — and
 * a worklet is fetched by URL at runtime, so a path that is right in one of
 * those is wrong in the others. A blob URL is right in all of them.
 */
const CAPTURE_WORKLET = `
class FoolCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      // Copied before posting: the render quantum's buffer is reused by the
      // engine on the next call, so what arrived would otherwise be rewritten
      // before the main thread ever looked at it.
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}
registerProcessor('fool-capture', FoolCaptureProcessor);
`;

let workletUrl: string | null = null;
const captureWorkletUrl = (): string => {
  workletUrl ??= URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
  return workletUrl;
};

export type MicrophoneOptions = {
  /** The rate the chosen provider listens at. */
  sampleRate: number;
  deviceId?: string | null;
  onAudio: (pcm16Base64: string) => void;
  /** Called with every block's level, for the waveform. */
  onLevel?: (level: number) => void;
};

export class PcmMicrophone {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  /** True while a reply is playing, so nothing is sent back to its own model. */
  private muted = false;

  async start(options: MicrophoneOptions): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
        channelCount: 1,
        // The three that decide whether this is a conversation or a feedback
        // loop. Named explicitly rather than left to the defaults because the
        // defaults differ per platform and the failure is subtle: the model
        // hears itself and talks over its own reply.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.context = new AudioContext({ sampleRate: options.sampleRate, latencyHint: 'interactive' });
    await this.context.audioWorklet.addModule(captureWorkletUrl());
    if (this.context.state === 'suspended') await this.context.resume();

    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'fool-capture', { numberOfOutputs: 0 });

    const contextRate = this.context.sampleRate;
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const block = event.data;
      options.onLevel?.(levelOf(block));
      if (this.muted) return;
      options.onAudio(float32ToPcm16Base64(resamplePcm(block, contextRate, options.sampleRate)));
    };

    // No connection to `destination`: a worklet with no outputs is pulled by the
    // graph on its own, and routing the microphone to the speakers — which the
    // `ScriptProcessorNode` this replaced had to do to be scheduled at all — is
    // how a headset-less machine howls.
    this.source.connect(this.node);
  }

  /**
   * Stops sending without closing the device.
   *
   * Used where the provider does its own barge-in detection but the room is
   * loud: reopening the microphone costs a permission-free but still visible
   * device handshake, and doing that between every turn is audible as a gap.
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  stop(): void {
    if (this.node) this.node.port.onmessage = null;
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}

/**
 * How far ahead of the clock the first chunk of a reply is scheduled.
 *
 * A jitter buffer, and the only number here worth arguing about. Too small and
 * the network's unevenness becomes crackle at the start of every sentence; too
 * large and the assistant sounds like it is answering from a satellite. Eighty
 * milliseconds absorbs an ordinary hiccup and is below what anyone hears as a
 * delay.
 */
const LEAD_SECONDS = 0.08;

export class PcmAudioOutput {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private scheduledUntil = 0;
  private readonly playing = new Set<AudioBufferSourceNode>();
  private volume = 1;
  private sampleRate = 24000;

  /** Called when the queue empties, so the page can stop saying "speaking". */
  onDrained: (() => void) | null = null;

  configure(sampleRate: number, volume: number): void {
    this.sampleRate = sampleRate;
    this.volume = volume;
    if (this.gain && this.context) {
      // Ramped rather than set: an instant gain change on a running signal is a
      // step discontinuity, which is a click.
      this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.01);
    }
  }

  /** Routes playback to a chosen speaker, where the platform allows it. */
  async setOutputDevice(deviceId: string | null): Promise<void> {
    const context = this.context as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!context?.setSinkId || !deviceId) return;
    try {
      await context.setSinkId(deviceId);
    } catch {
      // An unplugged or disallowed device falls back to the default one, which
      // is better than a conversation that plays nowhere.
    }
  }

  async enqueue(base64: string, sampleRate?: number): Promise<void> {
    const context = this.ensureContext();
    if (context.state === 'suspended') await context.resume();

    const samples = pcm16Base64ToFloat32(base64);
    if (samples.length === 0) return;

    // A block that names its own rate wins: the context is opened once, and a
    // buffer created at the block's rate is resampled by the graph on playback.
    const buffer = context.createBuffer(1, samples.length, sampleRate ?? this.sampleRate);
    buffer.getChannelData(0).set(samples);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain as GainNode);

    const startAt = Math.max(context.currentTime + LEAD_SECONDS, this.scheduledUntil);
    source.start(startAt);
    this.scheduledUntil = startAt + buffer.duration;

    this.playing.add(source);
    source.onended = () => {
      this.playing.delete(source);
      if (this.playing.size === 0) this.onDrained?.();
    };
  }

  /** True while there is still audio scheduled to come out of the speaker. */
  get speaking(): boolean {
    return this.playing.size > 0;
  }

  /**
   * Throws away everything queued, immediately.
   *
   * This is barge-in. The user has started talking over a reply and the rest of
   * that reply is no longer wanted — not faded, not finished, gone. The context
   * stays open so the next word starts without a device handshake.
   */
  flush(): void {
    for (const source of this.playing) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source that had not started yet throws; it is being discarded
        // anyway, and disconnecting below is what actually removes it.
      }
      source.disconnect();
    }
    this.playing.clear();
    this.scheduledUntil = 0;
  }

  close(): void {
    this.flush();
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = null;
    this.gain = null;
  }

  private ensureContext(): AudioContext {
    if (this.context && this.context.state !== 'closed') return this.context;
    this.context = new AudioContext({ sampleRate: this.sampleRate, latencyHint: 'interactive' });
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.context.destination);
    this.scheduledUntil = 0;
    return this.context;
  }
}
