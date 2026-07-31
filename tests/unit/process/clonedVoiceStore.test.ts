/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClonedVoiceStore, clonedProfileId, parseClonedProfileId } from '@process/services/fool-voice/ClonedVoiceStore';

let root: string;

const addVoice = (id: string, manifest: unknown, options: { withAudio?: boolean } = {}) => {
  const directory = path.join(root, id);
  mkdirSync(directory, { recursive: true });
  if (options.withAudio !== false) writeFileSync(path.join(directory, 'reference.wav'), Buffer.alloc(64));
  writeFileSync(path.join(directory, 'voice.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
};

const ultron = { displayName: 'Ultron', languages: ['en'], referenceText: 'How is humanity saved.' };

describe('ClonedVoiceStore', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'cloned-voices-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads a voice from its recording and its transcript', () => {
    addVoice('ultron', ultron);

    const [voice] = new ClonedVoiceStore(root).list();

    expect(voice.id).toBe('ultron');
    expect(voice.displayName).toBe('Ultron');
    expect(voice.referenceText).toBe('How is humanity saved.');
    expect(voice.referenceWavPath.endsWith('reference.wav')).toBe(true);
  });

  // The engine aligns the new text against the reference using its transcript;
  // without one the result is noise rather than a voice.
  it('skips a voice with no transcript rather than offering one that cannot speak', () => {
    addVoice('mute', { displayName: 'Mute', referenceText: '   ' });

    expect(new ClonedVoiceStore(root).list()).toEqual([]);
  });

  it('skips a voice whose recording has gone', () => {
    addVoice('gone', ultron, { withAudio: false });

    expect(new ClonedVoiceStore(root).list()).toEqual([]);
  });

  // A Windows editor saving "UTF-8" adds a byte order mark, and JSON.parse
  // refuses it — the voice would just stop existing with no explanation.
  it('reads a manifest a text editor saved with a byte order mark', () => {
    addVoice('ultron', '﻿' + JSON.stringify(ultron));

    expect(new ClonedVoiceStore(root).list().map((voice) => voice.id)).toEqual(['ultron']);
  });

  it('loses one voice to a broken manifest, not the whole list', () => {
    addVoice('broken', '{ not json');
    addVoice('ultron', ultron);

    expect(new ClonedVoiceStore(root).list().map((voice) => voice.id)).toEqual(['ultron']);
  });

  it('reports nothing at all when no voice has been cloned', () => {
    expect(new ClonedVoiceStore(path.join(root, 'never-created')).list()).toEqual([]);
  });

  it('offers each voice as a ready, deletable profile against a cloning engine', () => {
    addVoice('ultron', ultron);

    const [profile] = new ClonedVoiceStore(root).profiles();

    expect(profile).toMatchObject({
      id: 'cloned:ultron',
      kind: 'cloned',
      state: 'ready',
      displayName: 'Ultron',
      deletable: true,
    });
  });

  // One card per recording. Offering the same clip under two engines put it on
  // screen twice under one id, and neither copy could say which would speak.
  it('offers each recording once, against the engine that renders clones', () => {
    addVoice('ultron', ultron);

    const profiles = new ClonedVoiceStore(root).profiles();

    expect(profiles).toHaveLength(1);
    expect(profiles[0].modelId).toBe('tts-pocket-int8-2026-01-26');
  });
});

describe('cloned profile ids', () => {
  it('round-trips a voice id', () => {
    expect(parseClonedProfileId(clonedProfileId('ultron'))).toBe('ultron');
  });

  it('leaves a preset id alone, so it still addresses a speaker index', () => {
    expect(parseClonedProfileId('libritts-p800')).toBeNull();
    expect(parseClonedProfileId('speaker-3')).toBeNull();
  });
});
