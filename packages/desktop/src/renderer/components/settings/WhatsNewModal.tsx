/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import type { ReleaseNoteEntry } from '@/common/update/releaseNotes';
import { Modal } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type WhatsNewState = {
  version: string;
  entries: ReleaseNoteEntry[];
};

/**
 * Decide what to do on this launch, given what was last recorded.
 *
 * Exported so the rule can be tested without a window: the interesting cases
 * are the ones that must stay quiet, and every one of them is a launch nobody
 * would think to check by hand.
 */
export const decideWhatsNew = (
  lastSeenVersion: string | undefined,
  currentVersion: string,
  entries: ReleaseNoteEntry[],
  /** Whether this installation has run before — see below. */
  returning: boolean
): 'show' | 'record' | 'nothing' => {
  // Nothing recorded happens two ways, and they want opposite answers. A fresh
  // install has missed nothing and should be left alone. Somebody updating from
  // a build older than this feature has missed exactly what this release
  // changed, and telling them nothing is how a "say what changed" feature ships
  // silent on the one update that introduces it.
  if (!lastSeenVersion) return returning && entries.length > 0 ? 'show' : 'record';
  if (lastSeenVersion === currentVersion) return 'nothing';
  // The version moved but there is nothing to read — a downgrade, or a
  // changelog that could not be found. Record it so this does not re-run on
  // every launch from here on.
  return entries.length > 0 ? 'show' : 'record';
};

/**
 * A changelog line, with its lead-in read as emphasis rather than as asterisks.
 *
 * Every bullet in this project's changelog opens with a bold sentence saying
 * what changed, and the rest explains it — which is the house style and is
 * worth keeping. Rendered as plain text, though, the reader gets the asterisks:
 * `**The first word takes four minutes.** Measured on…`. The first release
 * anybody saw this modal for was full of them.
 *
 * Deliberately only `**bold**`. A changelog is prose with an emphasised opening
 * clause; pulling in a markdown renderer for that would bring links, images and
 * raw HTML into a dialogue shown on first launch, and none of those belong
 * there.
 */
export const splitEmphasis = (line: string): { text: string; strong: boolean }[] => {
  const runs: { text: string; strong: boolean }[] = [];
  // Non-greedy, and a run may not be empty, so `****` stays as written rather
  // than becoming an invisible element.
  const pattern = /\*\*(.+?)\*\*/g;
  let read = 0;

  for (const match of line.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > read) runs.push({ text: line.slice(read, at), strong: false });
    runs.push({ text: match[1], strong: true });
    read = at + match[0].length;
  }
  if (read < line.length) runs.push({ text: line.slice(read), strong: false });
  return runs.length > 0 ? runs : [{ text: line, strong: false }];
};

const ReleaseEntry: React.FC<{ entry: ReleaseNoteEntry }> = ({ entry }) => (
  <section className='mb-24px last:mb-0'>
    <h3 className='m-0 mb-12px text-15px font-600 text-t-1'>{entry.version}</h3>
    {entry.sections.map((section, sectionIndex) => (
      <div key={`${section.title}-${sectionIndex}`} className='mb-12px last:mb-0'>
        {section.title ? (
          <p className='m-0 mb-6px text-12px font-500 uppercase tracking-wide text-t-tertiary'>{section.title}</p>
        ) : null}
        <ul className='m-0 pl-18px flex flex-col gap-6px'>
          {section.items.map((item, itemIndex) => (
            <li key={itemIndex} className='text-13px leading-relaxed text-t-secondary'>
              {splitEmphasis(item).map((run, runIndex) =>
                run.strong ? (
                  <strong key={runIndex} className='font-600 text-t-primary'>
                    {run.text}
                  </strong>
                ) : (
                  <React.Fragment key={runIndex}>{run.text}</React.Fragment>
                )
              )}
            </li>
          ))}
        </ul>
      </div>
    ))}
  </section>
);

/**
 * Says what changed, once, on the first launch after an update.
 *
 * An update now installs without showing anything and brings the app straight
 * back up, which is what was asked for — but it leaves the app changed under
 * somebody who was given no chance to see how. This is the other half of that.
 * It reads the changelog shipped inside the app rather than asking GitHub, so
 * it works on the machine that came back up without a network.
 */
const WhatsNewModal: React.FC = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<WhatsNewState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const lastSeenVersion = await ConfigStorage.get('system.lastSeenVersion');
      // Proof this installation ran before the build that started recording a
      // version: the main process writes the window's size and position when it
      // is moved or closed, so any real prior session leaves one and a machine
      // opening the app for the first time has none. Deliberately not the
      // first-run flag, which is only ever set in memory and so is `undefined`
      // on every launch, including the ten-thousandth.
      const returning = Boolean(await ConfigStorage.get('window.bounds'));
      const response = await ipcBridge.update.releaseNotes.invoke({ since: lastSeenVersion });
      if (cancelled || !response.success || !response.data) return;

      const { currentVersion, entries } = response.data;
      const decision = decideWhatsNew(lastSeenVersion, currentVersion, entries, returning);
      if (decision === 'nothing') return;
      if (decision === 'record') {
        await ConfigStorage.set('system.lastSeenVersion', currentVersion);
        return;
      }
      setState({ version: currentVersion, entries });
    };

    // A launch is not the moment to interrupt anybody with a failure to
    // describe a launch, so nothing here is allowed to surface.
    void run().catch((e: unknown) => console.warn('Unhandled promise rejection:', e));
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    const version = state?.version;
    setState(null);
    // Recorded on dismissal rather than on display, so a window closed by a
    // crash shows the same notes again instead of losing them.
    if (version)
      void ConfigStorage.set('system.lastSeenVersion', version).catch((e: unknown) =>
        console.warn('Unhandled promise rejection:', e)
      );
  }, [state]);

  if (!state) return null;

  return (
    <Modal
      visible
      title={t('update.whatsNew.title', { version: state.version })}
      onCancel={dismiss}
      onOk={dismiss}
      okText={t('update.whatsNew.dismiss')}
      cancelButtonProps={{ style: { display: 'none' } }}
      style={{ width: 560 }}
      autoFocus
      focusLock
    >
      <div className='max-h-60vh overflow-y-auto pr-8px'>
        {state.entries.map((entry) => (
          <ReleaseEntry key={entry.version} entry={entry} />
        ))}
      </div>
    </Modal>
  );
};

export default WhatsNewModal;
