import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { VoiceModelManager } from '../../../packages/desktop/src/process/services/fool-voice/VoiceModelManager';
import type { VoiceDownloadProgress } from '../../../packages/desktop/src/common/types/foolVoice';

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

  it('does not download a model that is already installed', async () => {
    const onProgress = vi.fn<(progress: VoiceDownloadProgress) => void>();
    const manager = new VoiceModelManager(tempUserData, onProgress);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // Lay down exactly the files the catalog expects.
    const modelDir = path.join(tempUserData, 'fool', 'models', 'local-sherpa', 'stt-whisper-tiny-int8-v1');
    for (const relative of [
      'sherpa-onnx-whisper-tiny.en/tiny.en-encoder.int8.onnx',
      'sherpa-onnx-whisper-tiny.en/tiny.en-decoder.int8.onnx',
      'sherpa-onnx-whisper-tiny.en/tiny.en-tokens.txt',
    ]) {
      const target = path.join(modelDir, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'x');
    }

    const outcome = await manager.downloadModel('op-1', 'stt-whisper-tiny-int8-v1');

    expect(outcome).toBe('already-installed');
    expect(fetchSpy).not.toHaveBeenCalled();
    // The listeners are told, so a stale "installing" button settles.
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ state: 'ready' }));
    fetchSpy.mockRestore();
  });

  it('refuses a second download of a model already in flight', async () => {
    const manager = new VoiceModelManager(tempUserData, () => {});

    // A request that never resolves stands in for a download in progress.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    const first = manager.downloadModel('op-1', 'stt-whisper-tiny-int8-v1');
    // Let the first call reach its fetch and register itself. Waited for rather
    // than slept through: the call goes via the disk, and a fixed delay is a bet
    // on how busy the machine is.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await expect(manager.downloadModel('op-2', 'stt-whisper-tiny-int8-v1')).resolves.toBe('already-running');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(manager.isDownloading('stt-whisper-tiny-int8-v1')).toBe(true);

    void first;
    fetchSpy.mockRestore();
  });

  it('refuses a second download even when both presses land in the same tick', async () => {
    const manager = new VoiceModelManager(tempUserData, () => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    // No await between them: the guard has to hold before any disk access.
    const first = manager.downloadModel('op-1', 'stt-whisper-tiny-int8-v1');
    const second = manager.downloadModel('op-2', 'stt-whisper-tiny-int8-v1');

    await expect(second).resolves.toBe('already-running');
    // The first download still has to reach its fetch, and it gets there
    // through the disk. Twenty milliseconds was enough on an idle machine and
    // lost the race on a busy one; waiting for the call itself cannot.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    void first;
    fetchSpy.mockRestore();
  });

  it('reports an http failure as a failed download instead of hanging', async () => {
    const progress: VoiceDownloadProgress[] = [];
    const manager = new VoiceModelManager(tempUserData, (event) => progress.push(event));
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' }));

    await manager.downloadModel('op-1', 'stt-whisper-tiny-int8-v1');

    const failure = progress.find((event) => event.state === 'failed');
    expect(failure).toBeDefined();
    expect(failure && 'errorCode' in failure && failure.errorCode).toBe('http-status');
    expect(manager.isDownloading('stt-whisper-tiny-int8-v1')).toBe(false);
    fetchSpy.mockRestore();
  });

  it('reports a corrupt archive with the protocol error code, not the extractor wording', async () => {
    const progress: VoiceDownloadProgress[] = [];
    const manager = new VoiceModelManager(tempUserData, (event) => progress.push(event));
    // Valid HTTP, but the body is not a bzip2 tar.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not an archive', { status: 200 }));

    await manager.downloadModel('op-1', 'stt-whisper-tiny-int8-v1');

    const failure = progress.find((event) => event.state === 'failed');
    expect(failure && 'errorCode' in failure && failure.errorCode).toBe('archive-invalid');
    // A half-written model directory must not be left behind claiming to exist.
    const state = await manager.getModelState('stt-whisper-tiny-int8-v1');
    expect(state.status).toBe('not-installed');
    fetchSpy.mockRestore();
  });
});
