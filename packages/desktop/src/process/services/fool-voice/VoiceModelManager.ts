import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { VoiceDownloadProgress, VoiceModelState } from '../../../common/types/foolVoice';
import { VoiceModelCatalog, type ManagedCatalogEntry } from './VoiceModelCatalog';
import { extractBzip2Tar, ArchiveExtractionError } from './archive';

type DownloadOperation = {
  operationId: string;
  providerId: 'local-sherpa';
  modelId: string;
  abortController: AbortController;
  progress: VoiceDownloadProgress;
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

  private getModelsDir(): string {
    return path.join(this.userDataPath, 'fool', 'models', 'local-sherpa');
  }

  private getDownloadsDir(): string {
    return path.join(this.userDataPath, 'fool', 'downloads');
  }

  public async getModelState(modelId: string): Promise<Exclude<VoiceModelState, { status: 'unmanaged' }>> {
    const entry = VoiceModelCatalog.getManagedEntry(modelId);
    if (!entry) return { status: 'not-installed' };

    const modelDir = path.join(this.getModelsDir(), modelId);

    try {
      await fs.access(modelDir);
    } catch {
      return { status: 'not-installed' };
    }

    let allFilesExist = true;
    for (const file of entry.expectedFiles) {
      try {
        await fs.access(path.join(modelDir, file));
      } catch {
        allFilesExist = false;
        break;
      }
    }

    if (!allFilesExist) {
      return { status: 'invalid', reason: 'missing-files' };
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
    modelId: string
  ): Promise<'started' | 'already-running' | 'already-installed'> {
    if (this.activeDownloads.has(modelId)) return 'already-running';

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
      const installed = await this.getModelState(modelId);
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
   * Whether a fully-sized part file is the archive we expect.
   *
   * Without a published checksum size is all there is to go on; the extraction
   * step still checks that every expected file came out.
   */
  private async archiveMatches(downloadPath: string, entry: ManagedCatalogEntry): Promise<boolean> {
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
    const { abortController, progress } = operation;

    const headers: Record<string, string> = {};
    // A part file at or past the expected size cannot be resumed from — the
    // range request would be unsatisfiable — so start it again.
    if (progress.downloadedBytes >= entry.archiveBytes) {
      await fs.unlink(downloadPath).catch(() => {});
      progress.downloadedBytes = 0;
    }
    if (progress.downloadedBytes > 0) {
      headers['Range'] = `bytes=${progress.downloadedBytes}-`;
    }

    const response = await fetch(entry.url, {
      headers,
      signal: abortController.signal,
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`http-${response.status}`);
    }

    const fileHandle = await fs.open(downloadPath, response.status === 206 ? 'a' : 'w');
    const hash = crypto.createHash('sha256');

    try {
      if (response.status !== 206) {
        // The server ignored the range: the file was reopened with 'w', so the
        // bytes already counted are gone.
        progress.downloadedBytes = 0;
        progress.attempt += 1;
        this.updateProgress(operation.modelId, progress);
      } else if (entry.sha256) {
        // The checksum covers the whole archive, so the resumed part has to be
        // folded into the hash before the new bytes arrive.
        const existingData = await fs.readFile(downloadPath);
        hash.update(existingData);
      }

      if (!response.body) throw new Error('network');

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        await fileHandle.write(value);
        if (entry.sha256) hash.update(value);

        progress.downloadedBytes += value.length;
        progress.sequence += 1;
        progress.updatedAtMs = Date.now();

        if (progress.sequence % 50 === 0) {
          this.updateProgress(operation.modelId, progress);
        }
      }

      this.updateProgress(operation.modelId, progress);

      if (entry.sha256 && hash.digest('hex') !== entry.sha256) {
        throw new Error('sha256-mismatch');
      }
    } finally {
      await fileHandle.close();
    }
  }

  public async cancelDownload(modelId: string): Promise<void> {
    const operation = this.activeDownloads.get(modelId);
    if (operation) {
      operation.abortController.abort();
    }
  }

  public async removeModel(modelId: string): Promise<void> {
    await this.cancelDownload(modelId);
    const modelDir = path.join(this.getModelsDir(), modelId);
    const downloadPath = path.join(this.getDownloadsDir(), `${modelId}.part`);

    await fs.rm(modelDir, { recursive: true, force: true });
    await fs.unlink(downloadPath).catch(() => {});
  }

  private updateProgress(modelId: string, progress: VoiceDownloadProgress) {
    const op = this.activeDownloads.get(modelId);
    if (op) {
      op.progress = progress;
    }
    this.onProgress(progress);
  }
}
