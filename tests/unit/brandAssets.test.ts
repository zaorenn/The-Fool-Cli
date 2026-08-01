import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BRAND_ICON_SIZES, generateBrandAssets } from '../../scripts/generate-fool-brand-assets';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

describe('The Fool brand asset generator', () => {
  it('uses a CJS-compatible async entrypoint', () => {
    const script = readFileSync(resolve(__dirname, '../../scripts/generate-fool-brand-assets.ts'), 'utf8');

    expect(script).toContain('void generateBrandAssets()');
    expect(script).not.toContain('await generateBrandAssets();');
  });

  it('emits deterministic Windows, tray, and PWA assets from the approved master', async () => {
    const rootDir = mkdtempSync(resolve(tmpdir(), 'the-fool-brand-assets-'));
    temporaryRoots.push(rootDir);
    const sourcePath = resolve(__dirname, '../../resources/branding/the-fool-master.png');

    await generateBrandAssets({ rootDir, sourcePath });

    expect(BRAND_ICON_SIZES).toEqual([16, 24, 32, 48, 64, 128, 180, 192, 256, 512]);
    for (const size of BRAND_ICON_SIZES) {
      const metadata = await sharp(resolve(rootDir, `resources/branding/icons/icon-${size}.png`)).metadata();
      expect([metadata.width, metadata.height]).toEqual([size, size]);
    }

    const appMetadata = await sharp(resolve(rootDir, 'resources/app.png')).metadata();
    const trayMetadata = await sharp(resolve(rootDir, 'resources/tray.png')).metadata();
    expect([appMetadata.width, appMetadata.height]).toEqual([512, 512]);
    expect([trayMetadata.width, trayMetadata.height]).toEqual([32, 32]);
    const { data: trayData, info: trayInfo } = await sharp(resolve(rootDir, 'resources/tray.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const trayColors = new Set<string>();
    for (let offset = 0; offset < trayData.length; offset += trayInfo.channels) {
      if (trayData[offset + 3] > 16)
        trayColors.add(`${trayData[offset]},${trayData[offset + 1]},${trayData[offset + 2]}`);
    }
    expect(trayColors).toEqual(new Set(['196,18,63']));

    const ico = readFileSync(resolve(rootDir, 'resources/app.ico'));
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);

    const { data, info } = await sharp(resolve(rootDir, 'resources/app.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const visibleColors = new Set<string>();
    for (let offset = 0; offset < data.length; offset += info.channels) {
      if (data[offset + 3] > 200) {
        visibleColors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
      }
    }
    expect(visibleColors).toEqual(new Set(['11,13,16', '196,18,63', '245,241,232']));
  });
});

/**
 * Android does not show a home-screen icon as given: it masks it to whatever
 * shape the launcher uses — circle, squircle, rounded square — and everything
 * outside the inner 80% safe zone is cropped away.
 *
 * The transparent mark cannot be declared maskable as it stands: it fills its
 * square, so a circle mask cuts the jester's hat points and the star's tips off.
 * Without a maskable icon at all, Android shrinks the whole thing into a white
 * circle instead, which is what the installed app looked like. So there is a
 * second icon: same mark, scaled into the safe zone, on an opaque brand
 * background that has something to be cropped.
 */
describe('The maskable PWA icon', () => {
  it('is opaque to its edges, so a mask has nothing transparent to cut into', async () => {
    const rootDir = mkdtempSync(resolve(tmpdir(), 'the-fool-maskable-'));
    temporaryRoots.push(rootDir);
    const sourcePath = resolve(__dirname, '../../resources/branding/the-fool-master.png');

    await generateBrandAssets({ rootDir, sourcePath });

    const file = resolve(rootDir, 'public/pwa/icon-maskable-512.png');
    const metadata = await sharp(file).metadata();
    expect([metadata.width, metadata.height]).toEqual([512, 512]);

    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparentPixels = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
      if (data[offset + 3] < 255) transparentPixels += 1;
    }
    expect(transparentPixels).toBe(0);
  });

  // The safe zone is the inner 80% — a circle of radius 40% of the width. Every
  // corner therefore has to be background, or the mark loses its extremities.
  it('keeps the mark inside the safe zone', async () => {
    const rootDir = mkdtempSync(resolve(tmpdir(), 'the-fool-maskable-zone-'));
    temporaryRoots.push(rootDir);
    const sourcePath = resolve(__dirname, '../../resources/branding/the-fool-master.png');

    await generateBrandAssets({ rootDir, sourcePath });

    const { data, info } = await sharp(resolve(rootDir, 'public/pwa/icon-maskable-512.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const centre = info.width / 2;
    const safeRadius = info.width * 0.4;
    const background = `${data[0]},${data[1]},${data[2]}`;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const distance = Math.hypot(x - centre, y - centre);
        if (distance <= safeRadius) continue;
        const offset = (y * info.width + x) * info.channels;
        expect(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`).toBe(background);
      }
    }
  });
});

/**
 * The manifest is what tells Android the maskable icon exists. Declaring the
 * transparent one maskable would be worse than declaring nothing — the launcher
 * would crop the artwork instead of padding it.
 */
describe('The web app manifest', () => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../public/manifest.webmanifest'), 'utf8')) as {
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  it('offers a maskable icon', () => {
    const maskable = manifest.icons.filter((icon) => icon.purpose?.split(/\s+/).includes('maskable'));
    expect(maskable.map((icon) => icon.src)).toEqual(['./pwa/icon-maskable-512.png']);
  });

  it('never claims the transparent icons are maskable', () => {
    for (const icon of manifest.icons) {
      if (icon.src.includes('maskable')) continue;
      expect(icon.purpose ?? 'any').not.toContain('maskable');
    }
  });
});
