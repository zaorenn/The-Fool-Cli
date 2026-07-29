import { describe, expect, it } from 'vitest';
import {
  VoiceModelCatalog,
  MANAGED_CATALOG_ENTRIES,
} from '../../../packages/desktop/src/process/services/fool-voice/VoiceModelCatalog';

describe('VoiceModelCatalog', () => {
  it('returns exactly three models', () => {
    const models = VoiceModelCatalog.getModels();
    expect(models.length).toBe(3);
  });

  it('contains multilingual Whisper tiny int8 STT', () => {
    const models = VoiceModelCatalog.getModels();
    const whisper = models.find((m) => m.id === 'stt-whisper-tiny-int8-v1');
    expect(whisper).toBeDefined();
    expect(whisper?.role).toBe('speech-to-text');
    expect(whisper?.languages).toContain('tr');
  });

  it('contains Supertonic 3 int8 TTS with Turkish and ten speakers', () => {
    const models = VoiceModelCatalog.getModels();
    const supertonic = models.find((m) => m.id === 'tts-supertonic-3-int8-2026-05-11');
    expect(supertonic).toBeDefined();
    expect(supertonic?.role).toBe('text-to-speech');
    expect(supertonic?.languages).toContain('tr');
    if (supertonic && 'profileIds' in supertonic) {
      expect(supertonic.profileIds.length).toBe(10);
    } else {
      expect.fail('missing profileIds');
    }
  });

  it('has required file manifests for managed entries', () => {
    const whisperEntry = VoiceModelCatalog.getManagedEntry('stt-whisper-tiny-int8-v1');
    expect(whisperEntry?.expectedFiles).toContain('sherpa-onnx-whisper-tiny/tiny-encoder.int8.onnx');
    expect(whisperEntry?.expectedFiles).toContain('sherpa-onnx-whisper-tiny/tiny-decoder.int8.onnx');
    expect(whisperEntry?.expectedFiles).toContain('sherpa-onnx-whisper-tiny/tiny-tokens.txt');

    const supertonicEntry = VoiceModelCatalog.getManagedEntry('tts-supertonic-3-int8-2026-05-11');
    expect(supertonicEntry?.expectedFiles).toContain('sherpa-onnx-supertonic-3-tts-int8-2026-05-11/tts.json');
    expect(supertonicEntry?.sha256).toBe('82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427');
  });
});
