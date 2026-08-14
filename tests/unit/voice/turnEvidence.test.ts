/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createTurnEvidence } from '@/common/voice/turnEvidence';

/**
 * The three facts the honesty gates need, derived in one place.
 *
 * They were accumulated separately in both runtimes with the same extractor
 * calls copy-pasted into each, which is how a guarantee comes to hold on one
 * path and not the other — nothing fails when a runtime forgets a field, the
 * user is simply lied to on that path.
 */
describe('what a turn is known to have done', () => {
  it('knows nothing before anything has run', () => {
    const evidence = createTurnEvidence();

    expect(evidence.lookedAtScreen).toBe(false);
    expect(evidence.startedPlayback).toBe(false);
    expect(evidence.appLaunchFailed).toBe(false);
  });

  it('takes a look only from a capture that came back with a screen', () => {
    const evidence = createTurnEvidence();
    evidence.observe('app_look_at_screen', { ok: false, error: 'no display permission' });
    expect(evidence.lookedAtScreen).toBe(false);

    evidence.observe('app_look_at_screen', { ok: true, screen: 'A terminal window.' });
    expect(evidence.lookedAtScreen).toBe(true);
  });

  /// Sticky on purpose: a screen seen two turns ago was still seen, so
  /// answering about it later is a report rather than a claim.
  it('keeps a screen it has seen', () => {
    const evidence = createTurnEvidence();
    evidence.observe('app_look_at_screen', { ok: true, screen: 'A terminal window.' });
    evidence.observe('app_search', { ok: true });

    expect(evidence.lookedAtScreen).toBe(true);
  });

  it('takes playback only from a player that reported sound', () => {
    const evidence = createTurnEvidence();
    evidence.observe('app_play', { ok: true, playing: false, opened: true });
    expect(evidence.startedPlayback).toBe(false);

    evidence.observe('app_play', { ok: true, playing: true, track: 'Bunny Girl' });
    expect(evidence.startedPlayback).toBe(true);
  });

  it('records a launch that failed, and forgets it once one succeeds', () => {
    const evidence = createTurnEvidence();
    evidence.observe('app_open_app', { ok: false, error: 'could-not-open' });
    expect(evidence.appLaunchFailed).toBe(true);

    evidence.observe('app_open_app', { ok: true, opened: true, name: 'Spotify' });
    expect(evidence.appLaunchFailed).toBe(false);
  });

  /// The Forza turn: the launch failed, and every other tool in the turn is
  /// irrelevant to whether a game is running.
  it('is not cleared by unrelated tools running afterwards', () => {
    const evidence = createTurnEvidence();
    evidence.observe('app_open_app', { ok: false, error: 'could-not-open' });
    evidence.observe('app_look_at_screen', { ok: true, screen: 'Forza Horizon 6 — store page' });
    evidence.observe('app_search', { ok: true });

    expect(evidence.appLaunchFailed).toBe(true);
  });

  it('ignores tools that cannot produce any of the three facts', () => {
    const evidence = createTurnEvidence();
    evidence.observe('app_remember', { ok: true });
    evidence.observe('app_theme', { ok: true });

    expect(evidence.lookedAtScreen).toBe(false);
    expect(evidence.startedPlayback).toBe(false);
    expect(evidence.appLaunchFailed).toBe(false);
  });
});
