import { describe, expect, it } from 'vitest';
import {
  VoiceModelCatalog,
  MANAGED_CATALOG_ENTRIES,
  engineArchiveBytes,
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
    // Names as they appear in the released archive: prefixed with the model
    // name, `tiny.en`. The earlier `tiny-…` spelling matched no file, so the
    // download failed its manifest check and an extracted copy read as missing.
    const whisperEntry = VoiceModelCatalog.getManagedEntry('stt-whisper-tiny-int8-v1');
    expect(whisperEntry?.expectedFiles).toContain('sherpa-onnx-whisper-tiny.en/tiny.en-encoder.int8.onnx');
    expect(whisperEntry?.expectedFiles).toContain('sherpa-onnx-whisper-tiny.en/tiny.en-decoder.int8.onnx');
    expect(whisperEntry?.expectedFiles).toContain('sherpa-onnx-whisper-tiny.en/tiny.en-tokens.txt');

    const supertonicEntry = VoiceModelCatalog.getManagedEntry('tts-supertonic-3-int8-2026-05-11');
    expect(supertonicEntry?.expectedFiles).toContain('sherpa-onnx-supertonic-3-tts-int8-2026-05-11/tts.json');
    expect(supertonicEntry?.sha256).toBe('82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427');
  });
});

describe('built-in downloadable voices', () => {
  it.each([
    ['tts-kokoro-en-v0_19-int8', 'en', 11],
    ['tts-piper-en-libritts-r', 'en', 8],
    ['tts-piper-tr-fettah', 'tr', 1],
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

  it.each(['tts-kokoro-en-v0_19-int8', 'tts-piper-en-libritts-r', 'tts-piper-tr-fettah', 'tts-zipvoice-distill-int8'])(
    'pins a measured checksum and manifest for %s',
    (modelId) => {
      const entry = VoiceModelCatalog.getManagedEntry(modelId);

      expect(entry?.url.startsWith('https://github.com/k2-fsa/sherpa-onnx/releases/download/')).toBe(true);
      expect(entry?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry?.archiveBytes).toBeGreaterThan(0);
      expect(entry?.expectedFiles.length).toBeGreaterThan(0);
    }
  );

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

/**
 * Two builds of one engine, and they must not be confused for each other.
 *
 * The CPU package has no CUDA backend compiled in at all — asked for one it
 * answers `CUDA backend requested but it is not registered in this build` — so
 * "which processor" is really "which download", and the wrong answer is a model
 * that installs and then cannot run.
 */
describe('audio.cpp engine builds', () => {
  it('offers a different build per processor, under different ids', () => {
    const cpu = VoiceModelCatalog.getEngine('audiocpp', 'cpu');
    const cuda = VoiceModelCatalog.getEngine('audiocpp', 'cuda');

    expect(cpu?.engineId).toBe('audiocpp');
    expect(cuda?.engineId).toBe('audiocpp-cuda');
    // Separate ids mean separate directories. They contain files of the same
    // names, and a half-overwritten engine presents as a broken model.
    expect(cpu?.engineId).not.toBe(cuda?.engineId);
    // Absent means the processor, for a caller that predates the setting.
    expect(VoiceModelCatalog.getEngine('audiocpp')?.engineId).toBe('audiocpp');
    expect(VoiceModelCatalog.getEngine('something-else', 'cuda')).toBeUndefined();
  });

  it('fetches the CUDA runtime before the executables that link against it', () => {
    const cuda = VoiceModelCatalog.getEngine('audiocpp', 'cuda');

    expect(cuda?.archives).toHaveLength(2);
    expect(cuda?.archives[0].url).toContain('cuda-runtime');
    expect(cuda?.archives[1].url).toContain('cuda-balance');
    // Both halves are spoken for in the progress total, or the bar finishes
    // three quarters of the way through an 800 MB download.
    expect(engineArchiveBytes(cuda!)).toBe(cuda!.archives[0].bytes + cuda!.archives[1].bytes);
    expect(engineArchiveBytes(cuda!)).toBeGreaterThan(engineArchiveBytes(VoiceModelCatalog.getEngine('audiocpp')!));
  });

  it('spawns the same executable whichever build is installed', () => {
    expect(VoiceModelCatalog.getEngine('audiocpp', 'cpu')?.binaryPath).toBe(
      VoiceModelCatalog.getEngine('audiocpp', 'cuda')?.binaryPath
    );
  });
});
