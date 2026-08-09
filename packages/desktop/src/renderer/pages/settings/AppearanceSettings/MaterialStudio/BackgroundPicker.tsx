/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Slider, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { configService } from '@/common/config/configService';
import {
  BACKGROUND_MAX_EDGE,
  SURFACE_BACKGROUND_CONFIG_KEY,
  accentFromPixels,
  defaultSurfaceBackground,
  sanitizeSurfaceBackground,
  type SurfaceBackground,
} from '@/common/theme/surfaceBackground';
import styles from './MaterialStudio.module.css';

/**
 * A picture behind the application, and the palette it asks for.
 *
 * The picture is reduced before it is kept. Somebody hands this a 4K
 * photograph and the application keeps 2560 pixels of it, which is past every
 * display this runs on and is the difference between a preference row and a
 * preference row nobody can sync to a phone.
 *
 * Choosing one also chooses the colour, once. The whole design rests on there
 * being exactly one thing to pick, and when there is a photograph on screen the
 * photograph has already picked it — so the accent is taken from the picture
 * and everything else derives from that as it always did. It is a starting
 * point, not a lock: the picker above is still right there.
 */

export type BackgroundPickerProps = {
  /** Sets the accent to the colour the picture turned out to be about. */
  onAccent: (hex: string) => void;
  /** The accent to keep when a picture has no colour worth taking. */
  accent: string;
};

/** Draws the file onto a canvas at a sane size and reads both answers off it. */
const reduce = async (file: File, fallbackAccent: string): Promise<{ image: string; accent: string }> => {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, BACKGROUND_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0, width, height);

    // The colour is read from a thumbnail rather than from every pixel of a
    // 4K photograph: the answer is the same to the byte that matters, and the
    // difference is between a few milliseconds and a locked window.
    const thumb = document.createElement('canvas');
    thumb.width = 96;
    thumb.height = Math.max(1, Math.round((96 * height) / width));
    const thumbContext = thumb.getContext('2d');
    const accent = thumbContext
      ? (thumbContext.drawImage(canvas, 0, 0, thumb.width, thumb.height),
        accentFromPixels(thumbContext.getImageData(0, 0, thumb.width, thumb.height).data, fallbackAccent))
      : fallbackAccent;

    return { image: canvas.toDataURL('image/jpeg', 0.82), accent };
  } finally {
    bitmap.close();
  }
};

const BackgroundPicker: React.FC<BackgroundPickerProps> = ({ accent, onAccent }) => {
  const { t } = useTranslation();
  const [background, setBackground] = useState<SurfaceBackground>(defaultSurfaceBackground);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBackground(sanitizeSurfaceBackground(configService.get(SURFACE_BACKGROUND_CONFIG_KEY)));
  }, []);

  const write = useCallback(async (next: SurfaceBackground): Promise<void> => {
    const repaired = sanitizeSurfaceBackground(next);
    setBackground(repaired);
    await configService.set(SURFACE_BACKGROUND_CONFIG_KEY, repaired);
  }, []);

  const choose = useCallback(async (): Promise<void> => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    const picked = await new Promise<File | null>((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      // A cancelled dialog fires nothing at all in some browsers, so the promise
      // is also released when focus comes back to the window.
      window.addEventListener('focus', () => setTimeout(() => resolve(input.files?.[0] ?? null), 300), { once: true });
      input.click();
    });
    if (!picked) return;

    setBusy(true);
    try {
      const { image, accent: found } = await reduce(picked, accent);
      await write({ ...background, image });
      if (found !== accent) onAccent(found);
    } finally {
      setBusy(false);
    }
  }, [accent, background, onAccent, write]);

  return (
    <div className='grid gap-9px'>
      <div className='flex flex-wrap items-center gap-8px'>
        <Button size='small' loading={busy} data-testid='background-choose' onClick={() => void choose()}>
          {t('settings.material.backgroundChoose')}
        </Button>
        {background.image ? (
          <>
            <span
              className={styles.thumb}
              style={{ backgroundImage: `url("${background.image}")` }}
              aria-hidden='true'
            />
            <Button size='small' data-testid='background-clear' onClick={() => void write(defaultSurfaceBackground())}>
              {t('settings.material.backgroundClear')}
            </Button>
          </>
        ) : null}
      </div>

      {background.image ? (
        <>
          <div className={styles.dial}>
            <span className={styles.dialHead}>
              <Typography.Text className='text-12px font-600 text-t-secondary'>
                {t('settings.material.backgroundOpacity')}
              </Typography.Text>
              <span className={styles.value}>{Math.round(background.opacity * 100)}%</span>
            </span>
            <Slider
              data-testid='background-opacity'
              value={background.opacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(value) => setBackground({ ...background, opacity: Array.isArray(value) ? value[0] : value })}
              onAfterChange={(value) => void write({ ...background, opacity: Array.isArray(value) ? value[0] : value })}
            />
          </div>
          <div className={styles.dial}>
            <span className={styles.dialHead}>
              <Typography.Text className='text-12px font-600 text-t-secondary'>
                {t('settings.material.backgroundBlur')}
              </Typography.Text>
              <span className={styles.value}>{background.blur}px</span>
            </span>
            <Slider
              data-testid='background-blur'
              value={background.blur}
              min={0}
              max={40}
              step={1}
              onChange={(value) => setBackground({ ...background, blur: Array.isArray(value) ? value[0] : value })}
              onAfterChange={(value) => void write({ ...background, blur: Array.isArray(value) ? value[0] : value })}
            />
          </div>
        </>
      ) : null}

      <Typography.Text className='text-11px leading-16px text-t-tertiary'>
        {t('settings.material.backgroundHint')}
      </Typography.Text>
    </div>
  );
};

export default BackgroundPicker;
