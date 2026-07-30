import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { VoiceDownloadProgress, VoiceModelState } from '../../../common/types/foolVoice';
import { VoiceModelCatalog } from './VoiceModelCatalog';
import { extractBzip2Tar, ArchiveExtractionError } from './archive';

type DownloadOperation = {
  operationId: string;
  providerId: 'local-sherpa';
  modelId: string;
  abortController: AbortController;
  progress: VoiceDownloadProgress;
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

  public async downloadModel(operationId: string, modelId: string): Promise<void> {
    if (this.activeDownloads.has(modelId)) return;

    const entry = VoiceModelCatalog.getManagedEntry(modelId);
    if (!entry) throw new Error('Model not found in catalog');

    const abortController = new AbortController();
    const downloadPath = path.join(this.getDownloadsDir(), `${modelId}.part`);

    let downloadedBytes = 0;
    try {
      const stat = await fs.stat(downloadPath);
      downloadedBytes = stat.size;
    } catch {
      await fs.mkdir(this.getDownloadsDir(), { recursive: true });
    }

    const progress: VoiceDownloadProgress = {
      state: 'downloading',
      operationId,
      providerId: 'local-sherpa',
      modelId,
      sequence: 1,
      attempt: 1,
      downloadedBytes,
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

    this.activeDownloads.set(modelId, operation);
    this.updateProgress(modelId, progress);

    try {
      await this.performDownload(operation, downloadPath, entry);

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
        let errorCode:
          | 'network'
          | 'http-status'
          | 'archive-invalid'
          | 'manifest-mismatch'
          | 'security-rejected'
          | 'io' = 'network';
        if (err instanceof ArchiveExtractionError) {
          errorCode = err.reason as any; // Map archive errors
        } else if (err.message === 'sha256-mismatch') {
          errorCode = 'manifest-mismatch';
          await fs.unlink(downloadPath).catch(() => {});
        } else if (err.message.startsWith('http-')) {
          errorCode = 'http-status';
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
  }

  private async performDownload(operation: DownloadOperation, downloadPath: string, entry: any): Promise<void> {
    const { abortController, progress } = operation;

    const headers: Record<string, string> = {};
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
        progress.downloadedBytes = 0;
        progress.attempt += 1;
        this.updateProgress(operation.modelId, progress);
      } else if (entry.sha256) {
        // If resuming, we'd need to re-hash the existing part to check overall sha256.
        // For simplicity in this implementation, if sha256 is strictly required we might need to read it.
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
