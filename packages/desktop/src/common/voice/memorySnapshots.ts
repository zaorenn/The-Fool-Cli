/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VoiceMemory } from './memory';

/**
 * What the memory said before something changed it.
 *
 * The memory is two documents about a person, written by a model, out of
 * conversations that may have included a web page or somebody else's message.
 * Until now every write was final: nothing kept the previous version and
 * nothing recorded why a line appeared. That is the riskiest combination in the
 * application — a record the user cannot correct is a record they cannot
 * disown, and one they cannot see the provenance of is one they cannot argue
 * with.
 *
 * So every write leaves the version before it, with a reason. Cheap, because
 * these are two short markdown documents; and the only thing that makes an
 * automatic learning loop safe to switch on at all.
 */

export type MemorySnapshot = {
  /** What the memory was, before. */
  memory: VoiceMemory;
  /** Why it changed, in the words of whatever changed it. */
  reason: string;
  takenAt: number;
};

/**
 * How many versions are kept.
 *
 * Enough to walk back through an evening's conversation; small enough that two
 * markdown documents never become a database. The oldest goes first, because
 * the version somebody wants back is nearly always a recent one.
 */
export const MAX_SNAPSHOTS = 30;

/** Adds a version, dropping the oldest when there are too many. */
export const withSnapshot = (
  kept: readonly MemorySnapshot[],
  memory: VoiceMemory,
  reason: string,
  now: number = Date.now()
): MemorySnapshot[] => {
  const next = [...kept, { memory, reason, takenAt: now }];
  return next.length > MAX_SNAPSHOTS ? next.slice(next.length - MAX_SNAPSHOTS) : next;
};

/**
 * The version from before the most recent change, if there is one.
 *
 * Undo is by far the most common thing anybody wants from this: the assistant
 * has just written something wrong and the user says so in the next breath.
 */
export const previousVersion = (kept: readonly MemorySnapshot[]): MemorySnapshot | null =>
  kept.length === 0 ? null : kept[kept.length - 1];

/** Everything that can be gone back to, newest first, for a settings page. */
export const versionsNewestFirst = (kept: readonly MemorySnapshot[]): MemorySnapshot[] => [...kept].toReversed();

/**
 * Drops the version that was just restored, so undo does not become a loop.
 *
 * Without this, restoring the previous version and then restoring again would
 * put the change back — which reads to a user as the application arguing with
 * them about their own memory.
 */
export const afterRestoring = (kept: readonly MemorySnapshot[]): MemorySnapshot[] => kept.slice(0, -1);
