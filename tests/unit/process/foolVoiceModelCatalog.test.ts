import { describe, expect, it } from 'vitest';
import {
  VoiceModelCatalog,
  MANAGED_CATALOG_ENTRIES,
} from '../../../packages/desktop/src/process/services/fool-voice/VoiceModelCatalog';

describe('VoiceModelCatalog', () => {
  it('exposes one entry per catalog id with no duplicates', () => {
    const models = VoiceModelCatalog.getModels();
    expect(new Set(models.map((m) => m.id)).size).toBe(models.length);
  });

  it('offers a speech-to-text, a text-to-speech, and a wake-word model', () => {
    const roles = new Set(VoiceModelCatalog.getModels().map((m) => m.role));
    expect(roles).toEqual(new Set(['speech-to-text', 'text-to-speech', 'wake-word']));
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

describe('built-in downloadable voices', () => {
  it.each([
    ['tts-kokoro-en-v0_19-int8', 'en', 11],
    ['tts-piper-en-libritts-r-int8', 'en', 8],
    ['tts-piper-tr-fettah-int8', 'tr', 1],
  ])('registers %s as a %s text-to-speech model with %i pickable voices', (modelId, language, voiceCount) => {
    const model = VoiceModelCatalog.getModels().find((entry) => entry.id === modelId);

    expect(model?.role).toBe('text-to-speech');
    expect(model?.languages).toContain(language);
    expect(model && 'profileIds' in model ? model.profileIds.length : 0).toBe(voiceCount);
  });

  it('registers ZipVoice for cloning with no preset voices of its own', () => {
    const model = VoiceModelCatalog.getModels().find((entry) => entry.id === 'tts-zipvoice-distill-int8');

    expect(model && 'profileIds' in model ? model.profileIds : null).toEqual([]);
  });

  it.each([
    'tts-kokoro-en-v0_19-int8',
    'tts-piper-en-libritts-r-int8',
    'tts-piper-tr-fettah-int8',
    'tts-zipvoice-distill-int8',
  ])('pins a measured checksum and manifest for %s', (modelId) => {
    const entry = VoiceModelCatalog.getManagedEntry(modelId);

    expect(entry?.url.startsWith('https://github.com/k2-fsa/sherpa-onnx/releases/download/')).toBe(true);
    expect(entry?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry?.archiveBytes).toBeGreaterThan(0);
    expect(entry?.expectedFiles.length).toBeGreaterThan(0);
  });

  it('has no managed download without a matching catalog model', () => {
    const modelIds = new Set(VoiceModelCatalog.getModels().map((entry) => entry.id));

    for (const modelId of Object.keys(MANAGED_CATALOG_ENTRIES)) {
      expect(modelIds.has(modelId)).toBe(true);
    }
  });

  it('gives every preset voice a display name and a real model', () => {
    const modelIds = new Set(VoiceModelCatalog.getModels().map((entry) => entry.id));

    for (const profile of VoiceModelCatalog.getPresetProfiles()) {
      expect(profile.displayName.length).toBeGreaterThan(0);
      expect(modelIds.has(profile.modelId)).toBe(true);
    }
  });

  it('does not reuse a preset voice id across models', () => {
    const ids = VoiceModelCatalog.getPresetProfiles().map((profile) => profile.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
