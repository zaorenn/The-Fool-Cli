/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { chooseWindowSource, type WindowSource } from '@/common/voice/windowTarget';

const sources = (...names: string[]): WindowSource[] => names.map((name, index) => ({ id: `w${index}`, name }));

/**
 * Which window to photograph, when the question is about one of them.
 *
 * Looking used to mean the whole display, every time — and in the transcript
 * this was written from, twice in a row, to decide whether a click had worked.
 * That is the wrong picture for almost every question actually asked: "did that
 * finish", "what does this error say" are about one application, and a
 * photograph of the whole desktop is several things it might be about. It is
 * also more of the user's private life than the question needed.
 */
describe('chooseWindowSource', () => {
  it('finds the window a name refers to', () => {
    const chosen = chooseWindowSource(sources('Spotify Premium', 'Mail', 'Slack'), 'Spotify');
    expect(chosen?.name).toBe('Spotify Premium');
  });

  it('matches regardless of case and punctuation', () => {
    const chosen = chooseWindowSource(sources('Bunny Girl — spotify'), 'Spotify');
    expect(chosen?.name).toBe('Bunny Girl — spotify');
  });

  /**
   * A title that *is* the name beats one that merely contains it. Otherwise
   * "Spotify" loses to "Spotify Web Player — Uninstall" because that one
   * happened to sort first, and the model is handed the wrong window with
   * complete confidence.
   */
  it('prefers an exact title over one that merely contains the name', () => {
    const chosen = chooseWindowSource(sources('Spotify Web Player — Uninstall', 'Spotify'), 'Spotify');
    expect(chosen?.name).toBe('Spotify');
  });

  /**
   * Not fuzzy beyond a whole word. A near-miss is not a slightly worse answer —
   * it is a photograph of the wrong application, described confidently.
   */
  it('does not match a name buried inside another word', () => {
    expect(chooseWindowSource(sources('Spotifyer'), 'Spotify')).toBeNull();
    expect(chooseWindowSource(sources('Notepad++'), 'Note')).toBeNull();
  });

  it('answers with nothing when no window is it', () => {
    expect(chooseWindowSource(sources('Mail', 'Slack'), 'Spotify')).toBeNull();
    expect(chooseWindowSource([], 'Spotify')).toBeNull();
  });

  it('answers with nothing when no name was given', () => {
    expect(chooseWindowSource(sources('Spotify'), '')).toBeNull();
    expect(chooseWindowSource(sources('Spotify'), '   ')).toBeNull();
  });

  /**
   * Our own window is removed rather than out-ranked. Asked to look at
   * something, answering with a photograph of the window the user is talking to
   * is answering a question nobody asked.
   */
  it('never returns one of our own windows', () => {
    const chosen = chooseWindowSource(sources('The Fool', 'The Fool — Settings'), 'The Fool', ['The Fool']);
    expect(chosen).toBeNull();
  });

  it('still finds a real window while excluding our own', () => {
    const chosen = chooseWindowSource(sources('The Fool', 'Spotify'), 'Spotify', ['The Fool']);
    expect(chosen?.name).toBe('Spotify');
  });

  it('matches a name of several words', () => {
    const chosen = chooseWindowSource(sources('index.ts — Visual Studio Code'), 'Visual Studio Code');
    expect(chosen?.name).toBe('index.ts — Visual Studio Code');
  });

  it('ignores windows with no title at all', () => {
    expect(chooseWindowSource(sources('', '   '), 'Spotify')).toBeNull();
  });
});
