/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Opening a document beside the conversation, rather than handing it away.
 *
 * The app has had a PDF viewer, a Word viewer and a spreadsheet viewer for a
 * long time, and nothing the model could say would open one: `preview.open` was
 * a renderer-only channel with no tool behind it, and `app_open_url` refuses
 * anything that is not `http`. So the only way a spoken request ever got a
 * document onto the screen was `shell.openExternal` — which is not opening it
 * here, it is giving the file to whatever program the operating system has
 * registered, in a window this application cannot see or talk about.
 *
 * This is the missing half of `app_find_document`. The file it found is shown in the
 * panel next to the conversation, so the user reads it while still talking.
 */

import type { PreviewContentType } from '@/common/types/office/preview';
import { emitter } from '@/renderer/utils/emitter';

export type OpenedDocument = { path: string; name: string; viewer: PreviewContentType };

/**
 * Which viewer a file belongs in, from its extension.
 *
 * `null` means there is no viewer for it, which is answered as "I cannot show
 * you that" rather than by falling through to the operating system. A file
 * handed to `shell.openExternal` opens in a window this app knows nothing
 * about, and the assistant then reports having opened something it cannot see.
 */
export const viewerFor = (filePath: string): PreviewContentType | null => {
  const extension = filePath.split(/[?#]/u)[0].split('.').pop()?.toLowerCase() ?? '';

  switch (extension) {
    case 'pdf':
      return 'pdf';
    case 'doc':
    case 'docx':
    case 'rtf':
      return 'word';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'excel';
    case 'ppt':
    case 'pptx':
      return 'ppt';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'image';
    case 'html':
    case 'htm':
      return 'html';
    case 'txt':
    case 'log':
    case 'json':
    case 'yaml':
    case 'yml':
    case 'xml':
    case 'ts':
    case 'tsx':
    case 'js':
    case 'py':
    case 'rs':
      return 'code';
    default:
      return null;
  }
};

/** The name a person would use for the file, for the sentence said out loud. */
export const documentName = (filePath: string): string => filePath.split(/[/\\]/u).filter(Boolean).pop() ?? filePath;

/**
 * Shows the file in this app's own panel.
 *
 * Returns null when there is no viewer for it. Deliberately not a throw: the
 * caller has just downloaded something on the user's behalf and the file still
 * exists — "I have it but cannot display it" is a different sentence from "it
 * failed", and both are true things the assistant may need to say.
 */
export const openDocument = async (filePath: string): Promise<OpenedDocument | null> => {
  const path = filePath.trim();
  if (path.length === 0) return null;

  const viewer = viewerFor(path);
  if (!viewer) return null;

  // The file has to be there. This checked the string and nothing else, so a
  // model that said it had written a report and had not could pass the path it
  // imagined, be told it worked, and announce the document was open — while the
  // panel showed its name over an empty page. Seen on 16 Aug 2026 with a
  // research report that was never written to disk.
  //
  // Absent bridge means an environment without the main process (a test, the
  // web host), where refusing every document would be worse than trusting the
  // caller. Present bridge and a missing file is a no.
  //
  // `typeof window` rather than a bare reference: this module is imported where
  // there is no browser global at all, and naming `window` there is a
  // ReferenceError rather than an undefined.
  const exists = typeof window === 'undefined' ? undefined : window.electronAPI?.documentExists;
  if (typeof exists === 'function') {
    const there = await exists(path).catch((): boolean => false);
    if (!there) return null;
  }

  const name = documentName(path);
  const opening = {
    // `file_path` is the field that matters: the viewers that render a real
    // file — PDF, Word, Excel — read the disk and ignore `content`. It is set
    // as well so a text-shaped viewer has something rather than nothing, but
    // the path is what opens the document.
    content: path,
    contentType: viewer,
    metadata: { title: name, file_name: name, file_path: path },
  };

  // The renderer's own emitter, because this code *is* the renderer.
  //
  // It used to go out on `ipcBridge.preview.open`, which is the channel the
  // *main* process uses to reach the panel — so the message left this window
  // for the main process and nothing ever brought it back. `PreviewContext`
  // listens on both channels and only this one is reachable from here. The
  // effect was the worst kind: the tool returned success, the assistant said
  // it had opened the document, and no viewer appeared.
  emitter.emit('preview.open', opening);

  return { path, name, viewer };
};
