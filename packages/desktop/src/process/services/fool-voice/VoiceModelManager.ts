import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  LocalVoiceProviderId,
  VoiceDownloadProgress,
  VoiceEngineBackend,
  VoiceModelState,
} from '../../../common/types/foolVoice';
import {
  AUDIOCPP_CATALOG_ENTRIES,
  engineArchiveBytes,
  VoiceModelCatalog,
  type AudioCppCatalogEntry,
  type AudioCppFile,
  type EngineCatalogEntry,
  type ManagedCatalogEntry,
} from './VoiceModelCatalog';
import { extractBzip2Tar, extractZip, ArchiveExtractionError } from './archive';
import { getEngineSpec } from './voiceEngineSpecs';

type DownloadOperation = {
  operationId: string;
  providerId: LocalVoiceProviderId;
  modelId: string;
  abortController: AbortController;
  progress: VoiceDownloadProgress;
};

/** One transfer, whichever kind of artefact it belongs to. */
type Transfer = {
  url: string;
  sha256: string | null;
  bytes: number;
  /** Where the finished bytes land. */
  destination: string;
};

type DownloadErrorCode = Extract<VoiceDownloadProgress, { state: 'failed' }>['errorCode'];

/**
 * Extraction bounds, derived from the archive we agreed to download.
 *
 * A fixed cap cannot serve models that range from 60 MB to 560 MB compressed —
 * Whisper turbo unpacks to more than half a gigabyte and a flat 500 MB limit
 * rejected it as a zip bomb. Sizing the limit from the known archive keeps the
 * protection while letting every catalogued model through.
 */
const extractionLimits = (archiveBytes: number): { maxTotalBytes: number; maxFileSize: number } => {
  const headroom = Math.max(archiveBytes * 4, 256 * 1024 * 1024);
  // A single weights file can legitimately be the whole archive.
  return { maxTotalBytes: headroom, maxFileSize: headroom };
};

const toTransfer = (file: AudioCppFile): Transfer => ({
  url: file.url,
  sha256: file.sha256,
  bytes: file.bytes,
  destination: file.destination,
});

/** Maps a thrown error onto the progress protocol's error codes. */
const toErrorCode = (error: unknown): DownloadErrorCode => {
  if (error instanceof ArchiveExtractionError) {
    // `invalid-archive` is the extractor's wording for the same condition the
    // progress protocol calls `archive-invalid`.
    return error.reason === 'invalid-archive' ? 'archive-invalid' : error.reason;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message === 'sha256-mismatch') return 'manifest-mismatch';
  if (message.startsWith('http-')) return 'http-status';
  return 'network';
};

export class VoiceModelManager {
  private activeDownloads = new Map<string, DownloadOperation>();

  constructor(
    private userDataPath: string,
    private onProgress: (progress: VoiceDownloadProgress) => void
  ) {}

  private getModelsDir(providerId: LocalVoiceProviderId = 'local-sherpa'): string {
    return path.join(this.userDataPath, 'fool', 'models', providerId);
  }

  private getDownloadsDir(): string {
    return path.join(this.userDataPath, 'fool', 'downloads');
  }

  /** Where a pinned engine build is unpacked. Version in the path, so an upgrade is additive. */
  private engineDir(engine: EngineCatalogEntry): string {
    return path.join(this.userDataPath, 'fool', 'engines', engine.engineId, engine.version);
  }

  /**
   * The executable an installed engine offers, or `null` when it is not there.
   *
   * Returned as a path rather than spawned here: `AudioCppRuntime` takes its
   * binary as an injected dependency precisely so nothing has to assume a layout
   * that was not verified.
   */
  public async getEngineBinaryPath(engineId: string, backend: VoiceEngineBackend = 'cpu'): Promise<string | null> {
    const engine = VoiceModelCatalog.getEngine(engineId, backend);
    if (!engine) return null;
    const binary = path.join(this.engineDir(engine), engine.binaryPath);
    try {
      await fs.access(binary);
      return binary;
    } catch {
      return null;
    }
  }

  /** Where an installed audio.cpp model's weights live, for the server config. */
  public audioCppModelDir(modelId: string): string {
    return path.join(this.getModelsDir('local-audiocpp'), modelId);
  }

  private async filesExist(directory: string, files: readonly string[]): Promise<boolean> {
    for (const file of files) {
      try {
        await fs.access(path.join(directory, file));
      } catch {
        return false;
      }
    }
    return true;
  }

  public async getModelState(
    modelId: string,
    backend: VoiceEngineBackend = 'cpu'
  ): Promise<Exclude<VoiceModelState, { status: 'unmanaged' }>> {
    const audioCpp = VoiceModelCatalog.getAudioCppEntry(modelId);
    if (audioCpp) return this.getAudioCppModelState(audioCpp, backend);

    const entry = VoiceModelCatalog.getManagedEntry(modelId);
    if (!entry) return { status: 'not-installed' };

    const modelDir = path.join(this.getModelsDir(), modelId);

    try {
      await fs.access(modelDir);
    } catch {
      return { status: 'not-installed' };
    }

    if (!(await this.filesExist(modelDir, entry.expectedFiles))) {
      return { status: 'invalid', reason: 'missing-files' };
    }

    // Weights alone are not an installation. Every managed entry here is loaded
    // in-process by sherpa, so one with no engine spec has no loader behind it —
    // and reporting it ready is how a voice comes to be offered, downloaded,
    // chosen, and then silent, because the throw happens inside playback where
    // nothing surfaces it.
    if (!getEngineSpec(modelId)) return { status: 'invalid', reason: 'no-engine' };

    return { status: 'ready' };
  }

  /**
   * An audio.cpp model is only usable with its engine.
   *
   * Weights alone are not an installation here: there is no in-process decoder,
   * so a model whose engine is missing would report ready and then fail to
   * speak. Reported as `not-installed` rather than `invalid` so the UI offers
   * Install — which is exactly the action that fixes it.
   */
  private async getAudioCppModelState(
    entry: AudioCppCatalogEntry,
    backend: VoiceEngineBackend
  ): Promise<Exclude<VoiceModelState, { status: 'unmanaged' }>> {
    const modelDir = this.audioCppModelDir(entry.modelId);
    try {
      await fs.access(modelDir);
    } catch {
      return { status: 'not-installed' };
    }

    if (!(await this.filesExist(modelDir, entry.expectedFiles))) {
      return { status: 'invalid', reason: 'missing-files' };
    }
    if ((await this.getEngineBinaryPath(entry.engineId, backend)) === null) {
      return { status: 'not-installed' };
    }
    return { status: 'ready' };
  }

  /** Whether this model is being downloaded right now, by any caller. */
  public isDownloading(modelId: string): boolean {
    return this.activeDownloads.has(modelId);
  }

  /**
   * Downloads and installs a model.
   *
   * Two presses of Install must never mean two downloads of the same archive, so
   * a model already in flight is reported back rather than started again, and a
   * model already on disk is not re-fetched at all.
   */
  public async downloadModel(
    operationId: string,
    modelId: string,
    backend: VoiceEngineBackend = 'cpu'
  ): Promise<'started' | 'already-running' | 'already-installed'> {
    if (this.activeDownloads.has(modelId)) return 'already-running';

    // Two engines, one install button. audio.cpp models arrive as loose GGUF
    // weights plus a prebuilt engine, so they take the transfer path below
    // rather than the archive one — same slot, same progress events, same cancel.
    const audioCppEntry = VoiceModelCatalog.getAudioCppEntry(modelId);
    if (audioCppEntry) return this.downloadAudioCppModel(operationId, audioCppEntry, backend);

    const entry = VoiceModelCatalog.getManagedEntry(modelId);
    if (!entry) throw new Error('Model not found in catalog');

    const abortController = new AbortController();
    const downloadPath = path.join(this.getDownloadsDir(), `${modelId}.part`);

    const progress: VoiceDownloadProgress = {
      state: 'queued',
      operationId,
      providerId: 'local-sherpa',
      modelId,
      sequence: 1,
      attempt: 1,
      downloadedBytes: 0,
      totalBytes: entry.archiveBytes,
      updatedAtMs: Date.now(),
    };

    const operation: DownloadOperation = {
      operationId,
      providerId: 'local-sherpa',
      modelId,
      abortController,
      progress,
    };

    // The slot is claimed before the first `await`. Checking disk state first
    // would leave a window in which two presses both pass the guard above and
    // two transfers of the same archive start.
    this.activeDownloads.set(modelId, operation);

    try {
      const installed = await this.getModelState(modelId, backend);
      if (installed.status === 'ready') {
        // Tell the listeners so a stale "installing" button settles.
        this.updateProgress(modelId, {
          ...progress,
          state: 'ready',
          downloadedBytes: entry.archiveBytes,
          sequence: progress.sequence + 1,
          updatedAtMs: Date.now(),
        });
        return 'already-installed';
      }

      let downloadedBytes = 0;
      try {
        const stat = await fs.stat(downloadPath);
        downloadedBytes = stat.size;
      } catch {
        await fs.mkdir(this.getDownloadsDir(), { recursive: true });
      }

      operation.progress = {
        ...progress,
        state: 'downloading',
        downloadedBytes,
        sequence: progress.sequence + 1,
        updatedAtMs: Date.now(),
      };
      this.updateProgress(modelId, operation.progress);

      // A part file that is already the full size only needs checking, not
      // fetching again — re-downloading half a gigabyte the user has already
      // pulled down is the one thing worse than a slow install.
      const alreadyComplete =
        downloadedBytes === entry.archiveBytes && (await this.archiveMatches(downloadPath, entry));

      if (alreadyComplete) {
        this.updateProgress(modelId, {
          ...operation.progress,
          state: 'validating',
          sequence: operation.progress.sequence + 1,
          updatedAtMs: Date.now(),
        });
      } else {
        await this.performDownload(operation, downloadPath, entry);
      }

      this.updateProgress(modelId, {
        ...operation.progress,
        state: 'extracting',
        sequence: operation.progress.sequence + 1,
        updatedAtMs: Date.now(),
      });

      const targetDir = path.join(this.getModelsDir(), modelId);
      await extractBzip2Tar({
        archivePath: downloadPath,
        targetDir,
        expectedFiles: entry.expectedFiles,
        ...extractionLimits(entry.archiveBytes),
      });

      this.updateProgress(modelId, {
        ...operation.progress,
        state: 'ready',
        sequence: operation.progress.sequence + 1,
        updatedAtMs: Date.now(),
      });
      await fs.unlink(downloadPath).catch(() => {});
    } catch (err: any) {
      if (err.name === 'AbortError') {
        this.updateProgress(modelId, {
          ...operation.progress,
          state: 'cancelled',
          sequence: operation.progress.sequence + 1,
          updatedAtMs: Date.now(),
        });
      } else {
        const errorCode = toErrorCode(err);
        if (errorCode === 'manifest-mismatch') {
          // A wrong checksum means the bytes on disk are useless; keeping them
          // would make every retry resume into the same failure.
          await fs.unlink(downloadPath).catch(() => {});
        }
        if (errorCode === 'archive-invalid' || errorCode === 'security-rejected') {
          // Half-extracted output would otherwise be reported as `invalid` for
          // ever, with no way to retry from the UI.
          await fs.rm(path.join(this.getModelsDir(), modelId), { recursive: true, force: true }).catch(() => {});
        }
        this.updateProgress(modelId, {
          ...operation.progress,
          state: 'failed',
          errorCode,
          sequence: operation.progress.sequence + 1,
          updatedAtMs: Date.now(),
        });
      }
    } finally {
      this.activeDownloads.delete(modelId);
    }

    return 'started';
  }

  /**
   * Installs an audio.cpp model, and the engine it cannot run without.
   *
   * Two artefacts behind one button and one progress stream, because from the
   * user's side there is one thing to install. The engine is an 11 MB zip and
   * the weights are a couple of gigabytes, so the engine is fetched first: a
   * failure there costs seconds rather than being discovered after the long
   * download. An engine already on disk from the other audio.cpp model is
   * skipped, and its bytes leave the total.
   */
  private async downloadAudioCppModel(
    operationId: string,
    entry: AudioCppCatalogEntry,
    backend: VoiceEngineBackend
  ): Promise<'started' | 'already-running' | 'already-installed'> {
    const { modelId } = entry;
    const engine = VoiceModelCatalog.getEngine(entry.engineId, backend);
    if (!engine) throw new Error('Engine not found in catalog');
    const engineBytes = engineArchiveBytes(engine);

    const abortController = new AbortController();
    const progress: VoiceDownloadProgress = {
      state: 'queued',
      operationId,
      providerId: 'local-audiocpp',
      modelId,
      sequence: 1,
      attempt: 1,
      downloadedBytes: 0,
      totalBytes: entry.archiveBytes + engineBytes,
      updatedAtMs: Date.now(),
    };
    const operation: DownloadOperation = {
      operationId,
      providerId: 'local-audiocpp',
      modelId,
      abortController,
      progress,
    };
    // Claimed before the first `await`, as above: two presses must not become
    // two multi-gigabyte transfers.
    this.activeDownloads.set(modelId, operation);

    const modelDir = this.audioCppModelDir(modelId);
    const enginePart = path.join(this.getDownloadsDir(), `${engine.engineId}-${engine.version}.zip.part`);

    try {
      if ((await this.getModelState(modelId, backend)).status === 'ready') {
        this.updateProgress(modelId, {
          ...progress,
          state: 'ready',
          downloadedBytes: progress.totalBytes ?? 0,
          sequence: progress.sequence + 1,
          updatedAtMs: Date.now(),
        });
        return 'already-installed';
      }

      await fs.mkdir(this.getDownloadsDir(), { recursive: true });
      const engineInstalled = (await this.getEngineBinaryPath(entry.engineId, backend)) !== null;

      operation.progress = {
        ...progress,
        state: 'downloading',
        // The engine's bytes are already on disk, so counting them as still to
        // come would leave the bar stuck short of the end.
        totalBytes: entry.archiveBytes + (engineInstalled ? 0 : engineBytes),
        sequence: progress.sequence + 1,
        updatedAtMs: Date.now(),
      };
      this.updateProgress(modelId, operation.progress);

      let transferred = 0;
      if (!engineInstalled) {
        // One directory, filled from every archive the build is made of. Only
        // the last extraction is asked to prove the manifest: the CUDA runtime
        // package carries DLLs and none of the executables, so checking after
        // it would fail on a download that is going perfectly well.
        for (const [index, archive] of engine.archives.entries()) {
          const isLast = index === engine.archives.length - 1;
          transferred = await this.transferFile(
            operation,
            enginePart,
            { url: archive.url, sha256: archive.sha256, bytes: archive.bytes, destination: enginePart },
            transferred
          );

          this.updateProgress(modelId, {
            ...operation.progress,
            state: 'extracting',
            sequence: operation.progress.sequence + 1,
            updatedAtMs: Date.now(),
          });
          await extractZip({
            archivePath: enginePart,
            targetDir: this.engineDir(engine),
            expectedFiles: isLast ? engine.expectedFiles : [],
            ...extractionLimits(archive.bytes),
          });
          await fs.unlink(enginePart).catch(() => {});

          this.updateProgress(modelId, {
            ...operation.progress,
            state: 'downloading',
            sequence: operation.progress.sequence + 1,
            updatedAtMs: Date.now(),
          });
        }
      }

      await fs.mkdir(modelDir, { recursive: true });
      for (const file of entry.files) {
        const part = path.join(this.getDownloadsDir(), `${modelId}-${path.basename(file.destination)}.part`);
        transferred = await this.transferFile(operation, part, toTransfer(file), transferred);
        // Renamed only once the whole file is down, so a torn transfer never
        // looks like an installed model to `getModelState`.
        await fs.rename(part, path.join(modelDir, file.destination));
      }

      if (!(await this.filesExist(modelDir, entry.expectedFiles))) {
        throw new ArchiveExtractionError('manifest-mismatch', 'Downloaded files did not match the manifest');
      }

      this.updateProgress(modelId, {
        ...operation.progress,
        state: 'ready',
        sequence: operation.progress.sequence + 1,
        updatedAtMs: Date.now(),
      });
    } catch (error) {
      await this.reportDownloadFailure(operation, error, modelDir, [enginePart]);
    } finally {
      this.activeDownloads.delete(modelId);
    }

    return 'started';
  }

  /** Turns a failed install into the progress event the UI reads, and cleans up after it. */
  private async reportDownloadFailure(
    operation: DownloadOperation,
    error: unknown,
    modelDir: string,
    partPaths: readonly string[]
  ): Promise<void> {
    const { modelId } = operation;
    if ((error as { name?: string } | null)?.name === 'AbortError') {
      this.updateProgress(modelId, {
        ...operation.progress,
        state: 'cancelled',
        sequence: operation.progress.sequence + 1,
        updatedAtMs: Date.now(),
      });
      return;
    }

    const errorCode = toErrorCode(error);
    if (errorCode === 'manifest-mismatch') {
      for (const part of partPaths) await fs.unlink(part).catch(() => {});
    }
    if (errorCode === 'archive-invalid' || errorCode === 'security-rejected' || errorCode === 'manifest-mismatch') {
      // A half-written model directory would otherwise read as `invalid` for
      // ever, with no way to retry from the UI.
      await fs.rm(modelDir, { recursive: true, force: true }).catch(() => {});
    }
    this.updateProgress(modelId, {
      ...operation.progress,
      state: 'failed',
      errorCode,
      sequence: operation.progress.sequence + 1,
      updatedAtMs: Date.now(),
    });
  }

  /**
   * Whether a fully-sized part file is the archive we expect.
   *
   * Without a published checksum size is all there is to go on; the extraction
   * step still checks that every expected file came out.
   */
  private async archiveMatches(downloadPath: string, entry: { sha256: string | null }): Promise<boolean> {
    if (!entry.sha256) return true;

    try {
      const hash = crypto.createHash('sha256');
      const handle = await fs.open(downloadPath, 'r');
      try {
        const buffer = Buffer.alloc(8 * 1024 * 1024);
        let position = 0;
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (bytesRead === 0) break;
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
      } finally {
        await handle.close();
      }
      return hash.digest('hex') === entry.sha256;
    } catch {
      return false;
    }
  }

  private async performDownload(
    operation: DownloadOperation,
    downloadPath: string,
    entry: ManagedCatalogEntry
  ): Promise<void> {
    await this.transferFile(
      operation,
      downloadPath,
      { url: entry.url, sha256: entry.sha256, bytes: entry.archiveBytes, destination: downloadPath },
      0
    );
  }

  /**
   * Fetches one file, resuming a part that is already on disk.
   *
   * `baseBytes` is what earlier artefacts of the same install already
   * contributed to the progress bar; the reported total counts every file, so
   * this transfer's own bytes have to be added on top rather than replacing it.
   * Returns the running total, for the next transfer to carry on from.
   */
  private async transferFile(
    operation: DownloadOperation,
    downloadPath: string,
    transfer: Transfer,
    baseBytes: number
  ): Promise<number> {
    const { abortController, progress } = operation;

    let partBytes = 0;
    try {
      partBytes = (await fs.stat(downloadPath)).size;
    } catch {
      partBytes = 0;
    }
    // A part at or past the expected size cannot be resumed from — the range
    // request would be unsatisfiable — so start it again.
    if (partBytes >= transfer.bytes) {
      await fs.unlink(downloadPath).catch(() => {});
      partBytes = 0;
    }
    progress.downloadedBytes = baseBytes + partBytes;

    const headers: Record<string, string> = {};
    if (partBytes > 0) headers.Range = `bytes=${partBytes}-`;

    const response = await fetch(transfer.url, { headers, signal: abortController.signal });

    if (!response.ok && response.status !== 206) {
      throw new Error(`http-${response.status}`);
    }

    const fileHandle = await fs.open(downloadPath, response.status === 206 ? 'a' : 'w');
    const hash = crypto.createHash('sha256');

    try {
      if (response.status !== 206) {
        // The server ignored the range: the file was reopened with 'w', so the
        // bytes already counted are gone.
        partBytes = 0;
        progress.downloadedBytes = baseBytes;
        progress.attempt += 1;
        this.updateProgress(operation.modelId, progress);
      } else if (transfer.sha256) {
        // The checksum covers the whole file, so the resumed part has to be
        // folded into the hash before the new bytes arrive.
        hash.update(await fs.readFile(downloadPath));
      }

      if (!response.body) throw new Error('network');

      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        await fileHandle.write(value);
        if (transfer.sha256) hash.update(value);

        partBytes += value.length;
        progress.downloadedBytes += value.length;
        progress.sequence += 1;
        progress.updatedAtMs = Date.now();

        if (progress.sequence % 50 === 0) {
          this.updateProgress(operation.modelId, progress);
        }
      }

      this.updateProgress(operation.modelId, progress);

      if (transfer.sha256 && hash.digest('hex') !== transfer.sha256) {
        throw new Error('sha256-mismatch');
      }
    } finally {
      await fileHandle.close();
    }

    return baseBytes + partBytes;
  }

  public async cancelDownload(modelId: string): Promise<void> {
    const operation = this.activeDownloads.get(modelId);
    if (operation) {
      operation.abortController.abort();
    }
  }

  public async removeModel(modelId: string): Promise<void> {
    await this.cancelDownload(modelId);

    const audioCpp = VoiceModelCatalog.getAudioCppEntry(modelId);
    if (audioCpp) {
      await fs.rm(this.audioCppModelDir(modelId), { recursive: true, force: true });
      for (const file of audioCpp.files) {
        await fs
          .unlink(path.join(this.getDownloadsDir(), `${modelId}-${path.basename(file.destination)}.part`))
          .catch(() => {});
      }
      // The engine is shared, so it only goes when nothing is left to run on it.
      // Leaving it would waste 11 MB; removing it while the other model is still
      // installed would silently break that model instead.
      await this.removeEngineIfUnused(audioCpp.engineId);
      return;
    }

    const modelDir = path.join(this.getModelsDir(), modelId);
    const downloadPath = path.join(this.getDownloadsDir(), `${modelId}.part`);

    await fs.rm(modelDir, { recursive: true, force: true });
    await fs.unlink(downloadPath).catch(() => {});
  }

  /**
   * Removes every build of an engine once nothing is left that needs it.
   *
   * Both builds, not the one the setting currently names: a user who tried CUDA
   * and went back has 800 MB sitting in a directory the app would otherwise
   * never look at again, and removing the last model is the moment that becomes
   * obvious. A build that was never installed is a no-op.
   */
  private async removeEngineIfUnused(engineId: string): Promise<void> {
    const builds = ['cpu' as const, 'cuda' as const]
      .map((backend) => VoiceModelCatalog.getEngine(engineId, backend))
      .filter((engine): engine is EngineCatalogEntry => engine !== undefined);
    if (builds.length === 0) return;

    for (const entry of Object.values(AUDIOCPP_CATALOG_ENTRIES)) {
      if (entry.engineId !== engineId) continue;
      if (await this.filesExist(this.audioCppModelDir(entry.modelId), entry.expectedFiles)) return;
    }
    for (const build of builds) {
      await fs.rm(path.join(this.userDataPath, 'fool', 'engines', build.engineId), {
        recursive: true,
        force: true,
      });
    }
  }

  private updateProgress(modelId: string, progress: VoiceDownloadProgress) {
    const op = this.activeDownloads.get(modelId);
    if (op) {
      op.progress = progress;
    }
    this.onProgress(progress);
  }
}
