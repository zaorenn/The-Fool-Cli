/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One frame of one window, and nothing else on the machine.
 *
 * This exists because Electron's main-process capture cannot do it.
 * `desktopCapturer.getSources` renders a thumbnail for *every* source it
 * returns, at whatever size is asked for — so photographing one window at
 * display resolution photographs all of them, including the ones the user had
 * minimised, and throws the rest away. That is more of somebody's screen than a
 * full-display capture, taken to answer a question about a single application.
 *
 * `getUserMedia` with a `chromeMediaSourceId` opens a stream carrying only the
 * window that id names. The id comes from the main process, which found it by
 * title without rendering anything (`resolveWindowSource`). Nothing the user
 * did not ask about is ever drawn.
 *
 * The stream is stopped in a `finally`. A desktop capture left running is a
 * window being continuously recorded to answer one question about it.
 */

/** How long to wait for the first frame before giving up on the window. */
const FIRST_FRAME_TIMEOUT_MS = 4000;

/** The capture as the rest of the app passes it around — the shape IPC returns. */
export type WindowCapture = { filename: string; data: number[] };

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * Constraints Chromium accepts for a single desktop source.
 *
 * The `mandatory` block is not part of the standard `MediaTrackConstraints`,
 * which is why this is typed separately rather than cast at the call site: it
 * is a real Chromium extension, and pretending it is standard hides that from
 * anyone reading the call.
 */
type DesktopCaptureConstraints = {
  audio: false;
  video: { mandatory: { chromeMediaSource: 'desktop'; chromeMediaSourceId: string } };
};

const firstFrame = (stream: MediaStream): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const timer = setTimeout(() => reject(new Error('WINDOW_FRAME_TIMEOUT')), FIRST_FRAME_TIMEOUT_MS);

    video.onloadedmetadata = (): void => {
      clearTimeout(timer);
      void video.play().then(() => resolve(video), reject);
    };
    video.onerror = (): void => {
      clearTimeout(timer);
      reject(new Error('WINDOW_FRAME_FAILED'));
    };
    video.srcObject = stream;
  });

/**
 * A PNG of the named window, or null when nothing could be drawn.
 *
 * Null rather than a throw for the empty cases — a window that closed between
 * being resolved and being photographed is ordinary, and the caller turns it
 * into the same sentence either way.
 */
export const captureWindowFrame = async (sourceId: string): Promise<WindowCapture | null> => {
  const constraints: DesktopCaptureConstraints = {
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints);
  try {
    const video = await firstFrame(stream);
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;

    return {
      // Named `window-…` for the same reason the main process names its output:
      // the caller has to be able to tell what it actually got, and reporting a
      // look at one application when a display was captured is the failure this
      // whole area keeps producing.
      filename: `window-${stamp()}.png`,
      data: Array.from(new Uint8Array(await blob.arrayBuffer())),
    };
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
};
