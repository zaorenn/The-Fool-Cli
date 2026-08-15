/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { openDocument } from '@renderer/services/documents/documentViewer';
import type { ConversationActivity } from '../runtime/types';
import styles from './VoiceHud.module.css';

/**
 * What the agent is doing, as a trace rather than a stack of cards.
 *
 * The card list said the right things and shouted them: eight filled, rounded
 * boxes, each with a circular icon chip, all at the weight of the one thing on
 * the page that matters. Watching an agent work is a log — you scan it top to
 * bottom for where it got to — and a log is a line with marks on it.
 *
 * So: one hairline spine, a mark per step, the tool's own name as the line, and
 * a second line only where there is something worth reading. State is in the
 * mark rather than in an icon: crimson and pulsing while it runs, a hollow ring
 * when it is done, a filled cross when it failed.
 */

export type TraceRailProps = {
  activities: readonly ConversationActivity[];
};

const TraceRail: React.FC<TraceRailProps> = ({ activities }) => {
  const { t } = useTranslation();

  return (
    <>
      <div className={styles.railHead}>
        <span>{t('settings.voice.conversationAgentActivity')}</span>
        <span>{activities.length > 0 ? String(activities.length).padStart(2, '0') : '—'}</span>
      </div>

      {activities.length === 0 ? (
        <p className={styles.railEmpty}>{t('settings.voice.conversationActivityEmpty')}</p>
      ) : (
        <ol className={styles.trace} data-testid='voice-trace'>
          {activities.map((activity) => (
            <li key={activity.id} data-state={activity.state}>
              <span className={styles.what}>{activity.label || activity.detail}</span>
              {/* Only when it says something the label did not. A row repeating
                  itself in two weights is noise wearing a hierarchy. */}
              {activity.detail && activity.detail !== activity.label ? (
                <Typography.Text className={styles.detail}>{activity.detail}</Typography.Text>
              ) : null}
              {/* The way back from an auto-open that did not happen. It calls
                  exactly what the tool calls, so the document arrives in the
                  same panel by the same route — a second button with its own
                  idea of how to show a PDF would be a second thing to break. */}
              {activity.document ? (
                <Button
                  size='mini'
                  type='text'
                  className={styles.openDocument}
                  data-testid='voice-trace-open-document'
                  onClick={() => {
                    void openDocument(activity.document.path);
                  }}
                >
                  {t('settings.voice.conversationOpenDocument', { name: activity.document.name })}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );
};

export default TraceRail;
