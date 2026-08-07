/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { activeDisplay, captureScreen } from './screenCapture';

/**
 * Watching the user do something, so it can be written down as a skill.
 *
 * "Let me show you" is how people teach each other, and until now the app could
 * only be told. Telling works for a rule — "when I say find me a video, search
 * YouTube" — and falls apart for anything with a screen in it, because the part
 * that matters is which window, which menu, which of the four buttons that all
 * say Export.
 *
 * What is captured is a storyboard rather than a video: a frame every couple of
 * seconds, kept as ordinary PNGs in a folder. That is a deliberate choice and
 * not a shortcut. The thing that eventually reads this is a model writing a
 * SKILL.md, and a model reads a dozen stills far better than it reads sixty
 * seconds of H.264 — the stills are also the only form the user can open,
 * inspect and delete before anything is written from them.
 *
 * Two properties this must have, because it is a camera pointed at somebody's
 * desk. It only ever runs when it was asked for, out loud, and it stops on its
 * own: a recorder left running by a conversation that ended badly is a recorder
 * nobody remembers starting.
 */

/** How often a frame is taken. Slow enough to be cheap, quick enough to follow. */
const FRAME_INTERVAL_MS = 2500;

/**
 * The longest a recording may run before it stops itself.
 *
 * Six minutes is far longer than anyone spends demonstrating one thing, and the
 * point of the cap is the case where nobody says stop — the conversation drops,
 * the app is left alone, and the alternative to a cap is a folder that grows
 * until the disk is full.
 */
const MAX_RECORDING_MS = 6 * 60_000;

/** The most frames one session keeps, whatever the clock says. */
const MAX_FRAMES = 140;

export type SkillRecordingFrame = {
  /** File name inside the session folder. */
  file: string;
  /** Seconds since the recording started, so the order is readable. */
  at: number;
};

export type SkillRecording = {
  /** Where the frames are, which is also where the skill gets written. */
  folder: string;
  frames: readonly SkillRecordingFrame[];
  /** Seconds the recording ran for. */
  seconds: number;
  /** True when it stopped itself rather than being stopped. */
  timedOut: boolean;
};

type Session = {
  folder: string;
  startedAt: number;
  frames: SkillRecordingFrame[];
  timer: NodeJS.Timeout | null;
  timedOut: boolean;
  /** Set while a frame is being written, so a slow disk cannot overlap them. */
  busy: boolean;
};

let session: Session | null = null;

/** Where recordings live: beside the other things the app builds for itself. */
export const skillRecordingRoot = (): string => path.join(app.getPath('userData'), 'fool', 'skill-recordings');

/** A folder name from what the user called it, safe on every filesystem. */
export const recordingSlug = (name: string): string => {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : 'skill';
};

const takeFrame = async (current: Session): Promise<void> => {
  if (current.busy || current.frames.length >= MAX_FRAMES) return;
  current.busy = true;

  try {
    // The display the pointer is on: the one they are demonstrating on, which
    // is not always the one this window happens to be sitting on.
    activeDisplay();
    const shot = await captureScreen();
    if (!shot) return;

    const index = String(current.frames.length + 1).padStart(3, '0');
    const file = `frame-${index}.png`;
    await writeFile(path.join(current.folder, file), Buffer.from(shot.data));
    current.frames.push({ file, at: Math.round((Date.now() - current.startedAt) / 100) / 10 });
  } catch {
    // A dropped frame is not worth ending a recording over — the storyboard is
    // a sample, and one missing still leaves the rest readable.
  } finally {
    current.busy = false;
  }
};

/** Whether a recording is running right now. */
export const isRecordingSkill = (): boolean => session !== null;

/**
 * Starts watching, and answers with where the frames will be.
 *
 * A second start while one is running is the same request said twice — a model
 * calling the tool again after a slow answer — so it returns the folder already
 * in use rather than opening a second recorder onto the same screen.
 */
export const startSkillRecording = async (name: string): Promise<string> => {
  if (session) return session.folder;

  const folder = path.join(skillRecordingRoot(), `${recordingSlug(name)}-${Date.now()}`);
  await mkdir(folder, { recursive: true });

  const current: Session = { folder, startedAt: Date.now(), frames: [], timer: null, timedOut: false, busy: false };
  session = current;

  // One immediately, so a demonstration that is over in five seconds still has
  // something in it.
  void takeFrame(current);

  current.timer = setInterval(() => {
    if (session !== current) return;
    if (Date.now() - current.startedAt >= MAX_RECORDING_MS) {
      current.timedOut = true;
      void stopSkillRecording();
      return;
    }
    void takeFrame(current);
  }, FRAME_INTERVAL_MS);

  return folder;
};

/** Stops watching and hands back what was captured. */
export const stopSkillRecording = async (): Promise<SkillRecording | null> => {
  const current = session;
  if (!current) return null;
  session = null;

  if (current.timer) clearInterval(current.timer);
  current.timer = null;

  // A last frame after the interval was cleared: the thing being demonstrated
  // usually ends on the screen they wanted to show.
  await takeFrame(current);

  return {
    folder: current.folder,
    frames: current.frames,
    seconds: Math.round((Date.now() - current.startedAt) / 1000),
    timedOut: current.timedOut,
  };
};

/** Drops a recording in progress without keeping anything from it. */
export const cancelSkillRecording = (): void => {
  if (!session) return;
  if (session.timer) clearInterval(session.timer);
  session = null;
};
