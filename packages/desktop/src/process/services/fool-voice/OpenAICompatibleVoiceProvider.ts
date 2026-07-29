import { VoicePcm16Wav } from '../../../common/types/foolVoice';
import { AudioCodec } from './audioCodec';

export class OpenAICompatibleVoiceProvider {
  constructor(private getSettings: () => Promise<{ baseUrl: string; credentialId: string | null }>, private getCredential: (id: string) => Promise<string | null>) {}

  public async getHealth(): Promise<'ready' | 'unavailable' | 'unsupported'> {
    // In a real app we might ping `/v1/models` but for now we assume ready if configured.
    const settings = await this.getSettings();
    if (!settings.baseUrl) return 'unavailable';
    return 'ready';
  }

  public async transcribe(modelId: string, languageHint: string, audio: VoicePcm16Wav, signal?: AbortSignal): Promise<string> {
    const settings = await this.getSettings();
    const token = settings.credentialId ? await this.getCredential(settings.credentialId) : null;

    const startMs = Date.now();
    
    // We must send multipart/form-data
    const buffer = Buffer.from(audio.dataBase64, 'base64');
    const blob = new Blob([buffer], { type: 'audio/wav' });

    const formData = new FormData();
    formData.append('file', blob, 'audio.wav');
    formData.append('model', modelId);
    if (languageHint) {
      formData.append('language', languageHint);
    }
    
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${settings.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: formData,
      signal,
    });

    if (!res.ok) {
      throw new Error(`http-${res.status}`);
    }

    const data = await res.json();
    return data.text;
  }

  public async synthesize(modelId: string, profileId: string, language: string, speed: number, text: string, signal?: AbortSignal): Promise<{ audio: VoicePcm16Wav, durationMs: number }> {
    const settings = await this.getSettings();
    const token = settings.credentialId ? await this.getCredential(settings.credentialId) : null;
    
    const startMs = Date.now();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${settings.baseUrl}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        input: text,
        voice: profileId,
        response_format: 'wav',
        speed: speed,
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`http-${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    let wav: VoicePcm16Wav;
    try {
      // Decode and encode to ensure standard PCM16 format for our frontend AudioPlaybackService if needed.
      const decoded = AudioCodec.decodePcm16Wav(buffer);
      const reencoded = AudioCodec.encodePcm16Wav(decoded.samples, decoded.sampleRate);
      wav = {
        encoding: 'base64',
        mimeType: 'audio/wav',
        sampleRateHz: decoded.sampleRate as 16000,
        channels: 1,
        sampleFormat: 'pcm16le',
        byteLength: reencoded.length,
        dataBase64: reencoded.toString('base64'),
      };
    } catch {
      // If we can't decode it, we assume the API gave us valid WAV anyway, but try to infer sample rate (typically 24000)
      wav = {
        encoding: 'base64',
        mimeType: 'audio/wav',
        sampleRateHz: 24000 as any as 16000,
        channels: 1,
        sampleFormat: 'pcm16le',
        byteLength: buffer.length,
        dataBase64: buffer.toString('base64'),
      };
    }

    const durationMs = Date.now() - startMs;
    return { audio: wav, durationMs };
  }
}
