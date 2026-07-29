import { VoicePcm16Wav } from '../../../../common/types/foolVoice';

export class AudioPlaybackService {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;

  public async play(audio: VoicePcm16Wav): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new window.AudioContext({ sampleRate: audio.sampleRateHz });
    }

    const binaryString = window.atob(audio.dataBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer);

    this.stop();

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
