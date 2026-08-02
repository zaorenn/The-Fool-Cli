/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import type { VoiceAttachment } from '@renderer/services/voice/voiceEvents';
import { hasSpecificModelCapability } from '@renderer/utils/model/modelCapabilities';
import { uploadFileViaHttp } from '@renderer/services/FileService';

/**
 * The screen, sent with a spoken turn when the model can look at it.
 *
 * Talking to something across the room and having to describe what is on your
 * screen defeats the point. A model with vision gets the picture; a text-only
 * model gets nothing and is told nothing about it, because an attachment it
 * cannot read is worse than no attachment at all.
 *
 * What is captured is this window by default — the app's own view of itself,
 * through the capture the bug reporter already uses, so nothing outside the app
 * is photographed. Voice settings can widen that to the whole display the
 * pointer is on, which is what "look at this error" needs; it is opt-in for the
 * obvious reason.
 */

/** Kept small: this is sent on every spoken turn, not once. */
const SCREENSHOT_TYPE = 'image/png';

type ScreenshotCapture = { filename: string; data: number[] };

/**
 * Whether a model will accept an image.
 *
 * An explicit per-model setting wins, because the user said so; otherwise the
 * name is matched, which is a guess and treated as one — an unknown model gets
 * no screenshot rather than a rejected request.
 */
export const modelAcceptsImages = (provider: IProvider | undefined, modelId: string): boolean => {
  if (!provider || modelId.length === 0) return false;

  const explicit = provider.model_settings?.[modelId]?.image_input;
  if (explicit) return explicit === 'supported';

  return hasSpecificModelCapability(provider, modelId, 'vision') === true;
};

/**
 * Runs whichever capture the settings asked for.
 *
 * Both are the same shape and both answer null the same way, so the choice is
 * made once here rather than at every call site. Falling back from `screen` to
 * the window would defeat the point of asking for the screen, so it does not:
 * an unavailable capture is no screenshot.
 */
const captureFor = async (source: 'window' | 'screen'): Promise<ScreenshotCapture | null> => {
  const capture =
    source === 'screen' ? window.electronAPI?.captureScreen : window.electronAPI?.captureFeedbackScreenshot;
  if (typeof capture !== 'function') return null;
  try {
    return (await capture()) ?? null;
  } catch {
    return null;
  }
};

/**
 * Captures and uploads the screen for a spoken turn, or returns null.
 *
 * Null is the answer for every reason it should not happen: the setting is off,
 * nothing is pinned, the model is text-only, the capture failed, the upload
 * failed. The turn goes ahead in all of them — a missing screenshot must never
 * cost the user the thing they actually said.
 */
export const captureVoiceScreenshot = async (settings: FoolVoiceSettings): Promise<VoiceAttachment | null> => {
  if (!settings.session.attachScreenshot) return null;
  if (settings.session.modelId.length === 0) return null;

  let providers: IProvider[] = [];
  try {
    providers = (await ipcBridge.mode.listProviders.invoke()) ?? [];
  } catch {
    return null;
  }

  const provider = providers.find(
    (candidate) =>
      (settings.session.providerId.length === 0 || candidate.id === settings.session.providerId) &&
      (candidate.models ?? []).includes(settings.session.modelId)
  );
  if (!modelAcceptsImages(provider, settings.session.modelId)) return null;

  const shot = await captureFor(settings.session.screenshotSource);
  if (!shot) return null;

  try {
    const bytes = new Uint8Array(shot.data);
    const file = new File([bytes], shot.filename, { type: SCREENSHOT_TYPE });
    const path = await uploadFileViaHttp(file, undefined, undefined, shot.filename);
    return { name: shot.filename, path, size: bytes.byteLength, type: SCREENSHOT_TYPE, lastModified: Date.now() };
  } catch {
    return null;
  }
};
