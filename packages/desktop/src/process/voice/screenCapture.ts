/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { desktopCapturer, screen, type Display, type NativeImage } from 'electron';
import { flashScreenEdges } from './screenFlash';
import { cropForSelection, type Rect } from './selectionGeometry';
import { chooseWindowSource } from '@/common/voice/windowTarget';

/**
 * The screen, as the model gets to see it.
 *
 * The app already photographs its own window for a spoken turn, which is enough
 * when the question is about the app and useless when it is about anything else
 * — "what is this error" is asked about the thing in front of the app, not about
 * the app. This captures the display instead, and can narrow that to a rectangle
 * the user drew.
 *
 * `desktopCapturer` rather than `webContents.capturePage`: only the former sees
 * outside the app. It photographs whatever is on the display, so it is called
 * for a turn the user asked for and never on a timer.
 */

/** The capture as the rest of the app passes it around. */
export type ScreenCapture = { filename: string; data: number[] };

/**
 * Long enough that a slow compositor still answers, short enough that a spoken
 * turn is not left waiting on a screenshot that will never arrive.
 */
const CAPTURE_TIMEOUT_MS = 4000;

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

/** The display the pointer is on — the one the user is looking at. */
export const activeDisplay = (): Display => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

const withTimeout = async <T>(work: Promise<T>, onTimeout: () => T): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), CAPTURE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * The named display's pixels, or null.
 *
 * The thumbnail is asked for at the display's physical size — `desktopCapturer`
 * defaults to a 150×150 thumbnail, and a screenshot at that size is a smudge.
 * The source is matched by `display_id`, because on a multi-monitor machine the
 * order of the returned sources is not the order of the displays.
 */
const captureDisplayImage = async (display: Display): Promise<NativeImage | null> => {
  const width = Math.round(display.size.width * display.scaleFactor);
  const height = Math.round(display.size.height * display.scaleFactor);

  const sources = await withTimeout(
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } }),
    (): Electron.DesktopCapturerSource[] => []
  );
  if (sources.length === 0) return null;

  const wanted = String(display.id);
  const source = sources.find((candidate) => candidate.display_id === wanted) ?? sources[0];
  const image = source.thumbnail;
  return image.isEmpty() ? null : image;
};

const toCapture = (image: NativeImage, label: string): ScreenCapture | null => {
  const png = image.toPNG();
  if (!png || png.length === 0) return null;
  return { filename: `${label}-${stamp()}.png`, data: Array.from(png) };
};

/** The whole of the display the pointer is on. */
export const captureScreen = async (): Promise<ScreenCapture | null> => {
  try {
    // Shown, not awaited: the picture is taken while the light is still on, so
    // what the user saw and what the assistant read are the same moment. An
    // assistant that reads the screen without saying when is asking to be
    // trusted about the one thing that cannot be checked from the answer.
    flashScreenEdges();
    const image = await captureDisplayImage(activeDisplay());
    return image ? toCapture(image, 'screen') : null;
  } catch (error) {
    console.error('[ScreenCapture] the screen could not be captured:', error instanceof Error ? error.message : error);
    return null;
  }
};

/**
 * The open windows, by title, without photographing any of them.
 *
 * `thumbnailSize: {0, 0}` is the entire point of this function. `getSources`
 * renders a thumbnail for *every* source it returns, at whatever size it was
 * asked for — so the old way of finding one window by title, which asked at
 * display resolution, quietly photographed the user's mail, their messages and
 * every other open window in order to keep one and discard the rest. It was
 * more of their screen than a full-display capture, because it reached
 * minimised windows too.
 *
 * Asking which windows exist is a question about titles. It must not cost
 * pixels.
 */
export const listWindows = async (): Promise<{ id: string; name: string }[]> => {
  const sources = await withTimeout(
    desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } }),
    (): Electron.DesktopCapturerSource[] => []
  );
  return sources.map((source) => ({ id: source.id, name: source.name }));
};

/**
 * Which window a name refers to, or nothing when none of them is it.
 *
 * `null` is an answer, not a failure, and the caller must report it as one.
 * This used to fall back to the whole display: a look at Spotify with Spotify
 * closed came back as a description of everything else the user had open, and
 * the assistant said it had looked at Spotify. A wider picture is not a worse
 * answer to the question — it is an answer to a different one.
 *
 * Our own windows are excluded by title rather than by handle: the sources
 * carry a name and an id and nothing that ties one back to a BrowserWindow.
 */
export const resolveWindowSource = async (match: string): Promise<{ id: string; name: string } | null> =>
  chooseWindowSource(await listWindows(), match, ['The Fool']);

/**
 * One application's window, rather than everything on the display.
 *
 * Kept for callers that want the bytes in the main process. The renderer has a
 * better route — `captureWindowFrame` opens a stream carrying only the chosen
 * window — and should prefer it; this one has to ask `getSources` for pixels
 * again, which is the expensive path described on {@link listWindows}.
 *
 * Returns null when the window is not open. There is no fallback.
 */
export const captureWindow = async (match: string): Promise<ScreenCapture | null> => {
  try {
    const chosen = await resolveWindowSource(match);
    if (!chosen) return null;

    const display = activeDisplay();
    const sources = await withTimeout(
      desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: {
          width: Math.round(display.size.width * display.scaleFactor),
          height: Math.round(display.size.height * display.scaleFactor),
        },
      }),
      (): Electron.DesktopCapturerSource[] => []
    );

    const found = sources.find((source) => source.id === chosen.id);
    if (!found || found.thumbnail.isEmpty()) return null;

    flashScreenEdges();
    return toCapture(found.thumbnail, 'window');
  } catch (error) {
    console.error('[ScreenCapture] the window could not be captured:', error instanceof Error ? error.message : error);
    return null;
  }
};

/**
 * The part of a display the user drew a box around.
 *
 * A selection that is not a usable crop — a click, a box dragged off the screen,
 * a capture whose size is unknown — falls back to the whole display rather than
 * failing. The user asked for a picture; the worst outcome is a wider one.
 */
export const captureSelection = async (display: Display, selection: Rect): Promise<ScreenCapture | null> => {
  try {
    const image = await captureDisplayImage(display);
    if (!image) return null;

    const crop = cropForSelection(selection, display.size, image.getSize());
    if (!crop) return toCapture(image, 'screen');

    const cropped = image.crop(crop);
    return cropped.isEmpty() ? toCapture(image, 'screen') : toCapture(cropped, 'region');
  } catch (error) {
    console.error('[ScreenCapture] the region could not be captured:', error instanceof Error ? error.message : error);
    return null;
  }
};
