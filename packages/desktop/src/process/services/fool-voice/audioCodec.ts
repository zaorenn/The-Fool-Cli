export class AudioCodec {
  public static decodePcm16Wav(buffer: Buffer): { samples: Float32Array; sampleRate: number } {
    if (buffer.length < 44) {
      throw new Error('Invalid WAV: Buffer too small');
    }
    
    const chunkId = buffer.toString('utf8', 0, 4);
    if (chunkId !== 'RIFF') throw new Error('Invalid WAV: Missing RIFF');
    
    const format = buffer.toString('utf8', 8, 12);
    if (format !== 'WAVE') throw new Error('Invalid WAV: Missing WAVE');

    const numChannels = buffer.readUInt16LE(22);
    const sampleRate = buffer.readUInt32LE(24);
    const audioFormat = buffer.readUInt16LE(20);
    const bitsPerSample = buffer.readUInt16LE(34);

    if (audioFormat !== 1) throw new Error('Invalid WAV: Only PCM supported');
    if (numChannels !== 1) throw new Error('Invalid WAV: Only mono supported');
    if (bitsPerSample !== 16) throw new Error('Invalid WAV: Only 16-bit supported');
    if (sampleRate !== 16000 && sampleRate !== 24000) throw new Error(`Invalid WAV: Unsupported sample rate ${sampleRate}`);

    let dataOffset = 12;
    let dataSize = 0;
    while (dataOffset < buffer.length) {
      const chunkType = buffer.toString('utf8', dataOffset, dataOffset + 4);
      const chunkSize = buffer.readUInt32LE(dataOffset + 4);
      if (chunkType === 'data') {
        dataSize = chunkSize;
        dataOffset += 8;
        break;
      }
      dataOffset += 8 + chunkSize;
    }

    if (dataSize === 0 || dataOffset >= buffer.length) {
      throw new Error('Invalid WAV: Missing data chunk');
    }

    const numSamples = dataSize / 2;
    const samples = new Float32Array(numSamples);
    
    for (let i = 0; i < numSamples; i++) {
      const pcm16 = buffer.readInt16LE(dataOffset + i * 2);
      samples[i] = pcm16 / 32768.0;
    }

    return { samples, sampleRate };
  }

  public static encodePcm16Wav(samples: Float32Array, sampleRate: number): Buffer {
    const numSamples = samples.length;
    const dataSize = numSamples * 2;
    const bufferSize = 44 + dataSize;
    const buffer = Buffer.alloc(bufferSize);

    // RIFF chunk descriptor
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4); // Chunk size
    buffer.write('WAVE', 8);

    // fmt sub-chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size
    buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
    buffer.writeUInt16LE(1, 22); // NumChannels
    buffer.writeUInt32LE(sampleRate, 24); // SampleRate
    buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
    buffer.writeUInt16LE(2, 32); // BlockAlign
    buffer.writeUInt16LE(16, 34); // BitsPerSample

    // data sub-chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < numSamples; i++) {
      let s = Math.max(-1, Math.min(1, samples[i]));
      let val = s < 0 ? s * 32768 : s * 32767;
      buffer.writeInt16LE(Math.round(val), 44 + i * 2);
    }

    return buffer;
  }
}
