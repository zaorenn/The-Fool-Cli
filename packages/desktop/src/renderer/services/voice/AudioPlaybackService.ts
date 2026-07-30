import type { VoiceSynthesizedWav } from '@/common/types/foolVoice';

export class AudioPlaybackService {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;

  public async play(audio: VoiceSynthesizedWav): Promise<void> {
    // Deliberately no explicit sampleRate: voices emit different rates (Piper
    // 22.05 kHz, Kokoro 24 kHz) and pinning the context to whichever clip
    // played first would force every later clip through that rate.
    // `decodeAudioData` resamples into the context rate for us.
    this.audioContext ??= new window.AudioContext();

    const binaryString = window.atob(audio.dataBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer);

    this.stop();

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
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

  public stop(): void {
    if (this.currentSource) {
      this.currentSource.stop();
      this.currentSource = null;
    }
  }
}
