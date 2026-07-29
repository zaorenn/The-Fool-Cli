import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { VoiceModelManager } from '../../../packages/desktop/src/process/services/fool-voice/VoiceModelManager';
import { VoiceDownloadProgress } from '../../../packages/desktop/src/common/types/foolVoice';

describe('VoiceModelManager', () => {
  const tempUserData = path.join(__dirname, 'temp-user-data');

  beforeEach(async () => {
    await fs.mkdir(tempUserData, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempUserData, { recursive: true, force: true });
  });

  it('reports missing-files if expected files are not present', async () => {
    const manager = new VoiceModelManager(tempUserData, () => {});

    const modelDir = path.join(tempUserData, 'fool', 'models', 'local-sherpa', 'stt-whisper-tiny-int8-v1');
    await fs.mkdir(modelDir, { recursive: true });

    // Directory exists but files don't
    const state = await manager.getModelState('stt-whisper-tiny-int8-v1');
    expect(state.status).toBe('invalid');
    if (state.status === 'invalid') {
      expect(state.reason).toBe('missing-files');
    }
  });

  it('reports not-installed if directory does not exist', async () => {
    const manager = new VoiceModelManager(tempUserData, () => {});
    const state = await manager.getModelState('stt-whisper-tiny-int8-v1');
    expect(state.status).toBe('not-installed');
  });

  it('can cancel download', async () => {
    const onProgress = vi.fn();
    const manager = new VoiceModelManager(tempUserData, onProgress);

    // We would need to mock fetch here to simulate a real download
    // For this test we just ensure cancel doesn't crash if no active download
    await manager.cancelDownload('stt-whisper-tiny-int8-v1');
    expect(onProgress).not.toHaveBeenCalled();
  });
});
