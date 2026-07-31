/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { encodeWav } from './MicrophoneCapture';

/**
 * Turns whatever audio file a user drops into the mono PCM16 WAV the cloning
 * engine reads — without a native decoder or ffmpeg dependency.
 *
 * `AudioContext.decodeAudioData` already does the hard part: constructed with
 * a fixed `sampleRate`, the browser's own decoder resamples into it as part
 * of decoding, whatever the file's native rate was — the same guarantee that
 * lets a `<video>` element play audio at a different rate than the system
 * output device. What is left is downmixing (a stereo or multi-channel file
 * averaged to one channel) and the PCM16 WAV encoding {@link encodeWav}
 * already does for microphone capture.
 */

export type DecodedCloneAudio = {
  wav: ArrayBuffer;
  samples: Float32Array;
  sampleRateHz: 16000 | 24000;
  durationSec: number;
};

const downmixToMono = (buffer: AudioBuffer): Float32Array => {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
};

export const decodeAudioFileForCloning = async (
  file: File,
  targetSampleRateHz: 16000 | 24000 = 24000
): Promise<DecodedCloneAudio> => {
  const arrayBuffer = await file.arrayBuffer();
  const context = new AudioContext({ sampleRate: targetSampleRateHz });
  try {
    const decoded = await context.decodeAudioData(arrayBuffer);
    const samples = downmixToMono(decoded);
    return {
      wav: encodeWav(samples, targetSampleRateHz),
      samples,
      sampleRateHz: targetSampleRateHz,
      durationSec: decoded.duration,
    };
  } finally {
    void context.close();
  }
};
