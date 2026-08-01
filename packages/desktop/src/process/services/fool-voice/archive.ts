import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import bz2 from 'unbzip2-stream';
import tar from 'tar-stream';
import yauzl from 'yauzl';

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

/**
 * Rejects an entry name that would write outside {@link targetDir}.
 *
 * Zip entry names are attacker-controlled strings, and a `..` segment or a
 * drive-absolute path in one is the whole of the zip-slip class of bug. Windows
 * makes this worse than the tar case: backslashes are separators here too, so a
 * name has to be normalised on both before it can be judged.
 */
const isSafeEntryName = (name: string): boolean => {
  if (name.length === 0) return false;
  const normalized = path.posix.normalize(name.replace(/\\/g, '/'));
  if (normalized.startsWith('/') || normalized.startsWith('../') || normalized === '..') return false;
  // `C:` and friends: `path.isAbsolute` is platform-dependent, so check the
  // shape rather than trusting the host's rules.
  return !/^[a-z]:/i.test(normalized) && !path.isAbsolute(normalized);
};

/**
 * Unpacks a zip archive, with the same bounds and refusals the tar path uses.
 *
 * The audio.cpp engine package is a zip, and its files sit at the archive
 * **root** rather than under a top-level folder — upstream's packaging script
 * runs `Compress-Archive -Path <stage>\*`, which stores the staging directory's
 * contents, not the directory itself. So `audiocpp_server.exe` extracts
 * alongside its DLLs directly into {@link targetDir}, and nothing here strips a
 * prefix.
 */
export async function extractZip(options: ExtractionOptions): Promise<void> {
  const {
    archivePath,
    targetDir,
    expectedFiles,
    maxTotalBytes = 500 * 1024 * 1024,
    maxFileSize = 200 * 1024 * 1024,
  } = options;

  await fs.mkdir(targetDir, { recursive: true });

  const extractedFiles = new Set<string>();
  let totalBytesExtracted = 0;

  await new Promise<void>((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        reject(
          new ArchiveExtractionError('invalid-archive', `Could not open archive: ${openError?.message ?? 'unknown'}`)
        );
        return;
      }

      const fail = (error: ArchiveExtractionError): void => {
        zipfile.close();
        reject(error);
      };

      zipfile.on('error', (error: Error) =>
        reject(new ArchiveExtractionError('invalid-archive', `Read error: ${error.message}`))
      );
      zipfile.on('end', () => resolve());

      zipfile.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        if (!isSafeEntryName(name)) {
          fail(new ArchiveExtractionError('security-rejected', 'Path traversal attempt detected'));
          return;
        }

        const normalized = path.posix.normalize(name.replace(/\\/g, '/'));
        // yauzl reports a directory as a name ending in a slash, and nothing else.
        if (normalized.endsWith('/')) {
          fs.mkdir(path.join(targetDir, normalized), { recursive: true })
            .then(() => zipfile.readEntry())
            .catch((error: Error) =>
              fail(new ArchiveExtractionError('io', `Failed to create directory: ${error.message}`))
            );
          return;
        }

        if (extractedFiles.has(normalized)) {
          fail(new ArchiveExtractionError('security-rejected', 'Duplicate file entry detected'));
          return;
        }
        if (entry.uncompressedSize > maxFileSize) {
          fail(new ArchiveExtractionError('security-rejected', 'File exceeds maximum allowed size'));
          return;
        }

        extractedFiles.add(normalized);
        const destination = path.join(targetDir, normalized);

        zipfile.openReadStream(entry, (streamError, readStream) => {
          if (streamError || !readStream) {
            fail(new ArchiveExtractionError('invalid-archive', `Read error: ${streamError?.message ?? 'unknown'}`));
            return;
          }

          fs.mkdir(path.dirname(destination), { recursive: true })
            .then(() => {
              let fileSize = 0;
              readStream.on('data', (chunk: Buffer) => {
                fileSize += chunk.length;
                totalBytesExtracted += chunk.length;
                // Checked against the stream as well as against the header: a
                // zip's declared size is only a claim until the bytes arrive.
                if (fileSize > maxFileSize) {
                  readStream.destroy(
                    new ArchiveExtractionError('security-rejected', 'File exceeds maximum allowed size')
                  );
                } else if (totalBytesExtracted > maxTotalBytes) {
                  readStream.destroy(
                    new ArchiveExtractionError('security-rejected', 'Archive exceeds maximum total extraction size')
                  );
                }
              });

              return pipeline(readStream, createWriteStream(destination)).then(() => zipfile.readEntry());
            })
            .catch((error: Error) =>
              fail(
                error instanceof ArchiveExtractionError
                  ? error
                  : new ArchiveExtractionError('io', `Write error: ${error.message}`)
              )
            );
        });
      });

      zipfile.readEntry();
    });
  });

  const missingFiles = expectedFiles.filter((file) => !extractedFiles.has(file));
  if (missingFiles.length > 0) {
    throw new ArchiveExtractionError('manifest-mismatch', `Missing expected files: ${missingFiles.join(', ')}`);
  }
}
