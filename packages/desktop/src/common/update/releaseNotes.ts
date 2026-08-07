/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';

/** One `### heading` inside a version's entry, with the bullets under it. */
export type ReleaseNoteSection = {
  /** Empty when the bullets sat directly under the version heading. */
  title: string;
  items: string[];
};

export type ReleaseNoteEntry = {
  version: string;
  sections: ReleaseNoteSection[];
};

const VERSION_HEADING = /^##\s+(.+?)\s*$/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
const BULLET = /^[-*]\s+(.*)$/;

/**
 * Read `CHANGELOG.md` into one entry per released version.
 *
 * The file is written for people, not for this parser, so anything it does not
 * recognise is dropped rather than guessed at: the preamble above the first
 * version, a heading that is not a version number, prose between bullets. A
 * changelog nobody can read is a smaller failure than a changelog that invents
 * a line the release does not contain.
 *
 * Entries come back in the order the file lists them, which is newest first.
 */
export const parseChangelog = (markdown: string): ReleaseNoteEntry[] => {
  const entries: ReleaseNoteEntry[] = [];
  let entry: ReleaseNoteEntry | null = null;
  let section: ReleaseNoteSection | null = null;
  let bullet: string[] | null = null;

  const closeBullet = () => {
    if (bullet && section) {
      const text = bullet.join(' ').trim();
      if (text) section.items.push(text);
    }
    bullet = null;
  };

  const closeSection = () => {
    closeBullet();
    if (section && entry && section.items.length > 0) {
      entry.sections.push(section);
    }
    section = null;
  };

  const closeEntry = () => {
    closeSection();
    if (entry && entry.sections.length > 0) {
      entries.push(entry);
    }
    entry = null;
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const versionMatch = VERSION_HEADING.exec(raw);
    if (versionMatch) {
      closeEntry();
      const version = semver.valid(semver.coerce(versionMatch[1])) === null ? null : versionMatch[1].trim();
      // `semver.coerce` would happily turn "Unreleased 3" into 3.0.0, so the
      // heading has to look like a version on its own before it is believed.
      entry = version && /^\d+\.\d+\.\d+/.test(version) ? { version, sections: [] } : null;
      continue;
    }

    if (!entry) continue;

    const sectionMatch = SECTION_HEADING.exec(raw);
    if (sectionMatch) {
      closeSection();
      section = { title: sectionMatch[1], items: [] };
      continue;
    }

    const bulletMatch = BULLET.exec(raw);
    if (bulletMatch) {
      closeBullet();
      // Bullets that arrive before any `###` still belong to the release.
      section ??= { title: '', items: [] };
      bullet = [bulletMatch[1]];
      continue;
    }

    // A wrapped bullet is an indented continuation line; a blank line ends it.
    if (bullet && /^\s+\S/.test(raw)) {
      bullet.push(raw.trim());
      continue;
    }
    closeBullet();
  }

  closeEntry();
  return entries;
};

export type ReleaseNotesResult = {
  /** The version now running, which is what the reader should be told they have. */
  currentVersion: string;
  entries: ReleaseNoteEntry[];
};

export type ReleaseNotesRange = {
  /** The version the user last had open. Omitted on a first launch. */
  since?: string;
  /** The version now running. */
  upTo: string;
};

/**
 * Narrow parsed entries to what changed for this particular user.
 *
 * Half-open on purpose: `since` is what they have already read and is excluded,
 * `upTo` is what they are now running and is included. A build newer than the
 * one running — which happens when the repository is ahead of the installed
 * app — is left out, because it has not reached them yet.
 */
export const selectReleaseNotes = (entries: ReleaseNoteEntry[], range: ReleaseNotesRange): ReleaseNoteEntry[] => {
  const upTo = semver.valid(range.upTo);
  if (!upTo) return [];

  // An unreadable `since` is treated as "nothing seen yet" rather than as a
  // reason to show everything ever released.
  const since = range.since ? semver.valid(range.since) : null;

  return entries.filter((entry) => {
    const version = semver.valid(entry.version);
    if (!version) return false;
    if (semver.gt(version, upTo)) return false;
    return since ? semver.gt(version, since) : semver.eq(version, upTo);
  });
};
