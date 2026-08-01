import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

export const BRAND_ICON_SIZES = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512] as const;

const BRAND_PALETTE = [
  [11, 13, 16],
  [196, 18, 63],
  [245, 241, 232],
] as const;

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

type BrandGenerationOptions = {
  rootDir?: string;
  sourcePath?: string;
};

function nearestBrandColor(red: number, green: number, blue: number): (typeof BRAND_PALETTE)[number] {
  let nearest = BRAND_PALETTE[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of BRAND_PALETTE) {
    const distance = (red - candidate[0]) ** 2 + (green - candidate[1]) ** 2 + (blue - candidate[2]) ** 2;
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest;
}

async function applyBrandPalette(input: Buffer | string): Promise<Buffer> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(data.length);

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + 3];
    if (alpha === 0) {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 0;
      continue;
    }

    const color = nearestBrandColor(data[offset], data[offset + 1], data[offset + 2]);
    output[offset] = color[0];
    output[offset + 1] = color[1];
    output[offset + 2] = color[2];
    output[offset + 3] = alpha;
  }

  return sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ adaptiveFiltering: false, compressionLevel: 9 })
    .toBuffer();
}

async function resizeAndNormalize(source: Buffer, size: number): Promise<Buffer> {
  const resized = await sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  return applyBrandPalette(resized);
}

async function createTrayAsset(source: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(source)
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let offset = 0; offset < data.length; offset += info.channels) {
    data[offset] = 196;
    data[offset + 1] = 18;
    data[offset + 2] = 63;
  }

  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ adaptiveFiltering: false, compressionLevel: 9 })
    .toBuffer();
}
/**
 * The Android home-screen icon.
 *
 * A launcher masks whatever it is given to its own shape and keeps only the
 * inner 80% — so the transparent mark cannot simply be declared maskable: a
 * circle would cut the hat points and the star's tips clean off. Declaring
 * nothing is not free either; Android then pads the icon into a white circle,
 * which is how the installed app looked.
 *
 * So: the same mark scaled to the safe zone, centred on the brand's own dark
 * background, with the corners it can afford to lose.
 */
const MASKABLE_SIZE = 512;
/** 62% of the edge — comfortably inside the 80% safe zone, at any mask shape. */
const MASKABLE_MARK_SIZE = Math.round(MASKABLE_SIZE * 0.62);

async function createMaskableIcon(source: Buffer): Promise<Buffer> {
  const mark = await sharp(source)
    .resize(MASKABLE_MARK_SIZE, MASKABLE_MARK_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
    })
    .png()
    .toBuffer();

  const inset = Math.round((MASKABLE_SIZE - MASKABLE_MARK_SIZE) / 2);
  return sharp({
    create: { width: MASKABLE_SIZE, height: MASKABLE_SIZE, channels: 4, background: { r: 11, g: 13, b: 16, alpha: 1 } },
  })
    .composite([{ input: mark, left: inset, top: inset }])
    .png({ adaptiveFiltering: false, compressionLevel: 9 })
    .toBuffer();
}

async function createThemeCover(source: Buffer): Promise<Buffer> {
  const mark = await sharp(source)
    .resize(260, 260, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png()
    .toBuffer();

  return sharp({
    create: { width: 960, height: 540, channels: 4, background: { r: 11, g: 13, b: 16, alpha: 1 } },
  })
    .composite([{ input: mark, left: 350, top: 116 }])
    .png({ adaptiveFiltering: false, compressionLevel: 9 })
    .toBuffer();
}

export async function generateBrandAssets(options: BrandGenerationOptions = {}): Promise<void> {
  const rootDir = resolve(options.rootDir ?? DEFAULT_ROOT);
  const sourcePath = resolve(options.sourcePath ?? resolve(rootDir, 'resources/branding/the-fool-master.png'));
  const iconsDir = resolve(rootDir, 'resources/branding/icons');
  const resourcesDir = resolve(rootDir, 'resources');
  const pwaDir = resolve(rootDir, 'public/pwa');
  const themeAssetsDir = resolve(rootDir, 'packages/desktop/src/renderer/assets/themes');

  await Promise.all([
    mkdir(iconsDir, { recursive: true }),
    mkdir(pwaDir, { recursive: true }),
    mkdir(themeAssetsDir, { recursive: true }),
  ]);

  const normalizedMaster = await applyBrandPalette(sourcePath);
  const sizedAssets = new Map<number, Buffer>();
  for (const size of BRAND_ICON_SIZES) {
    const icon = await resizeAndNormalize(normalizedMaster, size);
    sizedAssets.set(size, icon);
    await writeFile(resolve(iconsDir, `icon-${size}.png`), icon);
  }

  const appIcon = sizedAssets.get(512);
  if (!appIcon) throw new Error('The 512 px brand asset was not generated.');

  await Promise.all([
    writeFile(resolve(rootDir, 'resources/branding/the-fool-master-flat.png'), appIcon),
    writeFile(resolve(resourcesDir, 'app.png'), appIcon),
    writeFile(resolve(resourcesDir, 'app_dev.png'), appIcon),
    writeFile(resolve(resourcesDir, 'icon.png'), appIcon),
    writeFile(resolve(resourcesDir, 'tray.png'), await createTrayAsset(normalizedMaster)),
    writeFile(resolve(pwaDir, 'icon-180.png'), sizedAssets.get(180)!),
    writeFile(resolve(pwaDir, 'icon-192.png'), sizedAssets.get(192)!),
    writeFile(resolve(pwaDir, 'icon-512.png'), appIcon),
    writeFile(resolve(pwaDir, 'icon-maskable-512.png'), await createMaskableIcon(normalizedMaster)),
    writeFile(resolve(themeAssetsDir, 'the-fool-theme.png'), await createThemeCover(normalizedMaster)),
  ]);

  const icoPaths = ICO_SIZES.map((size) => resolve(iconsDir, `icon-${size}.png`));
  await writeFile(resolve(resourcesDir, 'app.ico'), await pngToIco(icoPaths));
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryPath === import.meta.url) {
  void generateBrandAssets()
    .then(() => console.log('Generated The Fool Windows, tray, and PWA brand assets.'))
    .catch((error: unknown) => {
      console.error('Failed to generate The Fool brand assets:', error);
      process.exitCode = 1;
    });
}
