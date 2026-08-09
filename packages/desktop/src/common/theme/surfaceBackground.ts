/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A picture behind the application, and the palette that comes out of it.
 *
 * Two decisions are worth writing down.
 *
 * **It is stored as a data URL, downscaled.** The obvious alternative is a file
 * on disk and a path, and it fails the requirement this was built for: the same
 * interface has to arrive on a phone over the network, where a path on somebody
 * else's machine means nothing. Client preferences already cross that gap, so
 * the picture goes with them. The cap is not a limit on the file the user picks
 * — they can hand this a 4K photograph — it is what gets kept: 2560px on the
 * long edge is beyond any display this runs on, and a background sitting behind
 * a scrim does not repay a byte more.
 *
 * **The colours come out of the picture rather than being asked for.** The
 * whole point of a palette derived from one accent is that there is exactly one
 * thing to choose; when there is a photograph on screen, the photograph has
 * already chosen it. What is picked is the most *saturated* colour with real
 * presence — not the most common, which on almost every photograph is a grey or
 * a near-black, and would derive an application with no colour in it at all.
 */

export const SURFACE_BACKGROUND_CONFIG_KEY = 'ui.surfaceBackground';

export type SurfaceBackground = {
  /** The picture, as a data URL. Empty means there is none. */
  image: string;
  /** How much of it shows through, 0 to 1. The rest is the material's ground. */
  opacity: number;
  /** How far out of focus it is, in pixels. Text has to stay readable over it. */
  blur: number;
};

/** The long edge a stored picture is reduced to before it is kept. */
export const BACKGROUND_MAX_EDGE = 2560;

/**
 * The most a stored picture may weigh, in characters of data URL.
 *
 * Roughly six megabytes. Well past what the downscaler produces, and there to
 * stop something else — a hand-edited config, a model writing to this key —
 * putting an unbounded string in front of every read of the settings.
 */
export const BACKGROUND_MAX_CHARS = 6_000_000;

const DATA_URL = /^data:image\/(?:png|jpeg|webp|avif);base64,[A-Za-z0-9+/]+=*$/;

export const defaultSurfaceBackground = (): SurfaceBackground => ({ image: '', opacity: 0.5, blur: 0 });

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(asNumber)) return fallback;
  return Math.min(max, Math.max(min, Math.round(asNumber * 100) / 100));
};

/**
 * Repairs whatever was stored.
 *
 * This value ends up inside `url()` in a stylesheet, so anything that is not a
 * base64 image data URL is dropped rather than escaped: `url()` has too many
 * ways to be talked out of what it looks like, and there is no legitimate
 * reason for this key to hold anything else.
 */
export const sanitizeSurfaceBackground = (value: unknown): SurfaceBackground => {
  const fallback = defaultSurfaceBackground();
  if (typeof value !== 'object' || value === null) return fallback;

  const record = value as Record<string, unknown>;
  const raw = typeof record.image === 'string' ? record.image.trim() : '';
  const image = raw.length <= BACKGROUND_MAX_CHARS && DATA_URL.test(raw) ? raw : '';

  return {
    image,
    opacity: clamp(record.opacity, 0, 1, fallback.opacity),
    blur: clamp(record.blur, 0, 40, fallback.blur),
  };
};

/** True when there is a picture to draw. */
export const hasBackgroundImage = (background: SurfaceBackground): boolean => background.image.length > 0;

// ---------------------------------------------------------------------------
// The colour a picture is about
// ---------------------------------------------------------------------------

/** One pixel bucket: a hue's worth of the picture, and how much of it there is. */
type Bucket = { weight: number; red: number; green: number; blue: number };

/**
 * The accent a picture asks for.
 *
 * Pixels are bucketed by hue and weighted by how colourful and how mid-toned
 * they are, so a photograph of a red sunset over a grey city answers "red"
 * rather than "grey". Very dark and very pale pixels count for almost nothing:
 * they carry no hue anybody would recognise, and they are most of every
 * photograph ever taken.
 *
 * Takes raw RGBA — the caller does the decoding, which keeps this testable and
 * keeps a canvas out of a module shared with the main process.
 *
 * @param pixels RGBA bytes, four per pixel.
 * @param fallback returned when the picture has no colour worth taking.
 */
export const accentFromPixels = (pixels: Uint8ClampedArray | readonly number[], fallback: string): string => {
  const buckets = new Map<number, Bucket>();

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 128) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    if (delta < 24) continue;

    const lightness = (max + min) / 2 / 255;
    // A colour is worth most when it is both saturated and mid-toned. Squaring
    // keeps a small area of vivid colour from being outvoted by a large area of
    // something almost grey.
    const vividness = delta / 255;
    const presence = 1 - Math.abs(lightness - 0.5) * 2;
    const weight = vividness * vividness * Math.max(0.05, presence);

    let hue: number;
    if (max === red) hue = ((green - blue) / delta + 6) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    // Twenty-four buckets: fine enough to tell an orange from a red, coarse
    // enough that one photograph's noise does not split a colour in two.
    const key = Math.floor(((hue * 60) % 360) / 15);

    const bucket = buckets.get(key) ?? { weight: 0, red: 0, green: 0, blue: 0 };
    bucket.weight += weight;
    bucket.red += red * weight;
    bucket.green += green * weight;
    bucket.blue += blue * weight;
    buckets.set(key, bucket);
  }

  let best: Bucket | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.weight > best.weight) best = bucket;
  }
  // A picture with nothing colourful in it — a grey sky, a black-and-white
  // photograph — keeps whatever the user already had rather than being answered
  // with a colour invented for it.
  if (!best || best.weight < 1) return fallback;

  const channel = (total: number): string =>
    Math.min(255, Math.max(0, Math.round(total / best.weight)))
      .toString(16)
      .padStart(2, '0');

  return `#${channel(best.red)}${channel(best.green)}${channel(best.blue)}`;
};
