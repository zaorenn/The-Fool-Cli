/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { sanitizeVoiceMemory, type VoiceMemory } from './memory';

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

/**
 * The kept versions as they can be trusted.
 *
 * These come off disk, and every entry here is a memory the application will
 * put back into force on one click. So each is repaired through the same
 * sanitiser a stored memory goes through, a reason that is not a string becomes
 * an empty one rather than reaching a label, and a bad timestamp becomes now —
 * a version with no date is still worth restoring, and refusing the whole list
 * over one of them would throw away every undo the user had.
 */
export const sanitizeSnapshots = (value: unknown, now: number = Date.now()): MemorySnapshot[] => {
  if (!Array.isArray(value)) return [];

  const kept = value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      memory: sanitizeVoiceMemory(entry.memory),
      reason: typeof entry.reason === 'string' ? entry.reason : '',
      takenAt: typeof entry.takenAt === 'number' && Number.isFinite(entry.takenAt) ? entry.takenAt : now,
    }));

  return kept.length > MAX_SNAPSHOTS ? kept.slice(kept.length - MAX_SNAPSHOTS) : kept;
};
