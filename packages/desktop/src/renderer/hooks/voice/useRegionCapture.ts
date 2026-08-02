/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { ipcBridge } from '@/common';
import type { FileMetadata } from '@renderer/services/FileService';
import { uploadFileViaHttp } from '@renderer/services/FileService';
import { useLatestRef } from '@renderer/hooks/ui/useLatestRef';

/**
 * Puts a captured region into the composer as an attachment.
 *
 * The gesture — two taps on right Ctrl — and the capture both live in the main
 * process; this is the last leg, and it deliberately stops at attaching. Unlike
 * a spoken turn, a picture is not a question: the user drew a box around
 * something so they could then say what they want to know about it, and sending
 * it on its own would burn the turn before they had asked anything.
 *
 * The upload goes through the same HTTP path as a pasted image, so the composer
 * ends up holding a managed path exactly as it would if the screenshot had come
 * off the clipboard.
 */

const CAPTURE_TYPE = 'image/png';

export const useRegionCapture = (
  onFilesAdded: ((files: FileMetadata[]) => void) | undefined,
  conversationId: string | undefined
): void => {
  const onFilesAddedRef = useLatestRef(onFilesAdded);
  const conversationIdRef = useLatestRef(conversationId);

  useEffect(() => {
    const emitter = ipcBridge.foolVoice?.regionCaptured;
    // Optional because the browser build has no main process to raise it.
    if (typeof emitter?.on !== 'function') return;

    return emitter.on(({ filename, data }) => {
      void (async () => {
        try {
          const bytes = new Uint8Array(data);
          if (bytes.byteLength === 0) return;
          const file = new File([bytes], filename, { type: CAPTURE_TYPE });
          const path = await uploadFileViaHttp(file, conversationIdRef.current, undefined, filename);
          onFilesAddedRef.current?.([
            {
              name: filename,
              path,
              size: bytes.byteLength,
              type: CAPTURE_TYPE,
              lastModified: Date.now(),
            },
          ]);
        } catch (error) {
          // A capture that cannot be uploaded is dropped rather than surfaced:
          // the user is looking at the screen they just photographed, and an
          // error toast over it is worse than the picture simply not arriving.
          console.warn('[RegionCapture] the capture could not be attached', error);
        }
      })();
    });
  }, [conversationIdRef, onFilesAddedRef]);
};
