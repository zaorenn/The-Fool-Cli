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
