export const float32ToPcm16Base64 = (samples: Float32Array): string => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    const pcm = clamped < 0 ? clamped * 32768 : clamped * 32767;
    view.setInt16(index * 2, pcm, true);
  });

  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
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

export class PcmAudioOutput {
  private context: AudioContext | null = null;
  private scheduledUntil = 0;

  async enqueue(base64: string, sampleRate = 24000): Promise<void> {
    this.context ??= new AudioContext({ sampleRate });
    if (this.context.state === 'suspended') await this.context.resume();
    const samples = pcm16Base64ToFloat32(base64);
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startAt = Math.max(this.context.currentTime, this.scheduledUntil);
    source.start(startAt);
    this.scheduledUntil = startAt + buffer.duration;
  }

  interrupt(): void {
    if (!this.context) return;
    void this.context.close();
    this.context = null;
    this.scheduledUntil = 0;
  }
}

export class PcmMicrophone {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;

  async start(onAudio: (base64: string) => void, deviceId?: string | null): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId }, channelCount: 1 } : { channelCount: 1 },
    });
    this.context = new AudioContext({ sampleRate: 24000 });
    const source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => onAudio(float32ToPcm16Base64(event.inputBuffer.getChannelData(0)));
    source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  stop(): void {
    this.processor?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context) void this.context.close();
    this.processor = null;
    this.stream = null;
    this.context = null;
  }
}
