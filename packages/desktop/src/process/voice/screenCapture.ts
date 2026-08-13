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
 * One application's window, rather than everything on the display.
 *
 * The narrower picture, and the one nearly every question wants. "What does
 * that error say" is about a window; a photograph of three monitors gives the
 * model four things it might be reading and no way to choose, which is how a
 * look turns into another look. It is also less of the user's screen handed to
 * a model than the question required.
 *
 * Falls back to the whole display when nothing matches the name. A wider picture
 * is a worse answer; no picture at all is the assistant saying it cannot see,
 * which for a window that is genuinely open would simply be wrong.
 */
export const captureWindow = async (match: string): Promise<ScreenCapture | null> => {
  try {
    const display = activeDisplay();
    const width = Math.round(display.size.width * display.scaleFactor);
    const height = Math.round(display.size.height * display.scaleFactor);

    const sources = await withTimeout(
      desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width, height } }),
      (): Electron.DesktopCapturerSource[] => []
    );
    // Our own windows are excluded by title rather than by handle: the sources
    // carry a name and an id and nothing that ties one back to a BrowserWindow.
    const chosen = chooseWindowSource(
      sources.map((source) => ({ id: source.id, name: source.name })),
      match,
      ['The Fool']
    );

    flashScreenEdges();
    const found = chosen ? sources.find((source) => source.id === chosen.id) : undefined;
    if (!found || found.thumbnail.isEmpty()) {
      const whole = await captureDisplayImage(display);
      return whole ? toCapture(whole, 'screen') : null;
    }
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
