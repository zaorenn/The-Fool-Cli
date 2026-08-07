/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * How the conversation asks to be shown something, and writes what it learned.
 *
 * A thin handler on purpose. The recorder owns the camera and the folder; this
 * only translates three requests and refuses anything pointed outside the one
 * directory the app records into — a renderer that has been talked into asking
 * for `C:\Users` gets a refusal rather than a file written there.
 *
 * The recorder module is imported inside the handlers rather than at the top:
 * the bridges are wired before Electron is ready, and it reaches for the user
 * data directory at module scope.
 */

let registered = false;

/** Confines a path to the recordings root, the way the preview bridge does. */
const insideRecordings = async (wanted: string): Promise<string | null> => {
  const { skillRecordingRoot } = await import('./skillRecorder');
  const root = path.resolve(skillRecordingRoot());
  const resolved = path.resolve(wanted);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved === root || resolved.startsWith(prefix) ? resolved : null;
};

export function initSkillRecorderBridge(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('skill:record-start', async (_event, name: unknown): Promise<string> => {
    const { startSkillRecording } = await import('./skillRecorder');
    return startSkillRecording(typeof name === 'string' ? name : 'skill');
  });

  ipcMain.handle('skill:record-stop', async () => {
    const { stopSkillRecording } = await import('./skillRecorder');
    return stopSkillRecording();
  });

  ipcMain.handle('skill:record-cancel', async (): Promise<void> => {
    const { cancelSkillRecording } = await import('./skillRecorder');
    cancelSkillRecording();
  });

  /**
   * Writes the draft the assistant just composed, next to the frames.
   *
   * Confined to the recordings folder for the same reason the preview server is
   * confined to its own root: every byte of both arguments was written by a
   * language model, and a file-writing endpoint that takes any path is one
   * prompt injection away from being aimed somewhere else.
   */
  ipcMain.handle('skill:write-draft', async (_event, folder: unknown, body: unknown): Promise<boolean> => {
    if (typeof folder !== 'string' || typeof body !== 'string') return false;

    const target = await insideRecordings(folder);
    if (!target) return false;

    try {
      await mkdir(path.join(target, 'skill'), { recursive: true });
      await writeFile(path.join(target, 'skill', 'SKILL.md'), body, 'utf8');
      return true;
    } catch {
      return false;
    }
  });

  /** Where recordings go, so a session with no demonstration still has a folder. */
  ipcMain.handle('skill:record-root', async (): Promise<string> => {
    const { skillRecordingRoot } = await import('./skillRecorder');
    return skillRecordingRoot();
  });

  /** Makes a folder for a skill that was only described, never shown. */
  ipcMain.handle('skill:prepare-folder', async (_event, name: unknown): Promise<string> => {
    const { recordingSlug, skillRecordingRoot } = await import('./skillRecorder');
    const folder = path.join(
      skillRecordingRoot(),
      `${recordingSlug(typeof name === 'string' ? name : 'skill')}-${Date.now()}`
    );
    await mkdir(folder, { recursive: true });
    return folder;
  });
}
