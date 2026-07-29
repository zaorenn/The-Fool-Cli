import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import bz2 from 'unbzip2-stream';
import tar from 'tar-stream';

export type ExtractionOptions = {
  archivePath: string;
  targetDir: string;
  expectedFiles: string[];
  maxTotalBytes?: number;
  maxFileSize?: number;
};

export class ArchiveExtractionError extends Error {
  constructor(
    public reason: 'invalid-archive' | 'manifest-mismatch' | 'security-rejected' | 'io',
    message: string
  ) {
    super(message);
    this.name = 'ArchiveExtractionError';
  }
}

export async function extractBzip2Tar(options: ExtractionOptions): Promise<void> {
  const {
    archivePath,
    targetDir,
    expectedFiles,
    maxTotalBytes = 500 * 1024 * 1024,
    maxFileSize = 200 * 1024 * 1024,
  } = options;

  let totalBytesExtracted = 0;
  const extractedFiles = new Set<string>();

  await fs.mkdir(targetDir, { recursive: true });

  const extract = tar.extract();

  extract.on('entry', (header, stream, next) => {
    // Security checks
    if (header.type === 'symlink' || header.type === 'link') {
      stream.resume();
      return next(new ArchiveExtractionError('security-rejected', 'Symlinks and hardlinks are not allowed'));
    }

    if (header.type !== 'file' && header.type !== 'directory') {
      stream.resume();
      return next();
    }

    const normalizedPath = path.posix.normalize(header.name);
    if (path.isAbsolute(normalizedPath) || normalizedPath.startsWith('..') || normalizedPath.startsWith('/')) {
      stream.resume();
      return next(new ArchiveExtractionError('security-rejected', 'Path traversal attempt detected'));
    }

    if (extractedFiles.has(normalizedPath)) {
      stream.resume();
      return next(new ArchiveExtractionError('security-rejected', 'Duplicate file entry detected'));
    }

    if (header.type === 'directory') {
      fs.mkdir(path.join(targetDir, normalizedPath), { recursive: true })
        .then(() => {
          stream.resume();
          next();
        })
        .catch((err) => next(new ArchiveExtractionError('io', `Failed to create directory: ${err.message}`)));
      return;
    }

    if (header.size && header.size > maxFileSize) {
      stream.resume();
      return next(new ArchiveExtractionError('security-rejected', 'File exceeds maximum allowed size'));
    }

    extractedFiles.add(normalizedPath);
    const destPath = path.join(targetDir, normalizedPath);

    fs.mkdir(path.dirname(destPath), { recursive: true })
      .then(() => {
        const outStream = createWriteStream(destPath);
        let fileSize = 0;

        stream.on('data', (chunk) => {
          fileSize += chunk.length;
          totalBytesExtracted += chunk.length;

          if (fileSize > maxFileSize) {
            stream.destroy(new ArchiveExtractionError('security-rejected', 'File exceeds maximum allowed size'));
          } else if (totalBytesExtracted > maxTotalBytes) {
            stream.destroy(
              new ArchiveExtractionError('security-rejected', 'Archive exceeds maximum total extraction size')
            );
          }
        });

        stream.pipe(outStream);

        outStream.on('finish', () => next());
        outStream.on('error', (err) => next(new ArchiveExtractionError('io', `Write error: ${err.message}`)));
        stream.on('error', (err) => next(new ArchiveExtractionError('invalid-archive', `Read error: ${err.message}`)));
      })
      .catch((err) => next(new ArchiveExtractionError('io', `Failed to create directory: ${err.message}`)));
  });

  try {
    await pipeline(createReadStream(archivePath), bz2(), extract);
  } catch (err: any) {
    if (err instanceof ArchiveExtractionError) {
      throw err;
    }
    throw new ArchiveExtractionError('invalid-archive', `Extraction failed: ${err.message}`);
  }

  const missingFiles = expectedFiles.filter((f) => !extractedFiles.has(f));
  if (missingFiles.length > 0) {
    throw new ArchiveExtractionError('manifest-mismatch', `Missing expected files: ${missingFiles.join(', ')}`);
  }
}
