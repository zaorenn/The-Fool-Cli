/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Collapse, Slider, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { DIAL_GROUPS, dialSpec, formatDial, type DialKey } from './dials';
import styles from './MaterialStudio.module.css';

/**
 * Twenty dials, folded away until somebody wants one.
 *
 * All of them open at once is a wall, and a wall is what makes a settings page
 * feel like somebody else's control panel rather than yours. Closed by default,
 * grouped by what a person is trying to change — the colour, the depth, the
 * glassiness, the movement — so finding a dial is a question about the result
 * rather than about which of twenty words the developer chose.
 *
 * Two callbacks, not one, and the difference matters. Dragging a slider fires
 * continuously: applying every frame is what makes it feel live, and *storing*
 * every frame would be a few hundred writes to settle one shadow.
 */

export type DialGroupsProps = {
  /**
   * The dials the worn material actually feels.
   *
   * A blur slider on an opaque material moves a number nothing reads, and a
   * control that does nothing does not just fail on its own — it makes the user
   * doubt every other control on the page.
   */
  available: ReadonlySet<DialKey>;
  value: (key: DialKey) => number;
  /** While the slider is moving: show it, do not keep it. */
  onMove: (key: DialKey, value: number) => void;
  /** When it is let go: this is the one they meant. */
  onSettle: (key: DialKey, value: number) => void;
};

const single = (value: number | number[]): number => (Array.isArray(value) ? value[0] : value);

const DialGroups: React.FC<DialGroupsProps> = ({ available, value, onMove, onSettle }) => {
  const { t } = useTranslation();

  const groups = DIAL_GROUPS.map((group) => ({
    ...group,
    dials: group.dials.filter((key) => available.has(key)),
  })).filter((group) => group.dials.length > 0);

  return (
    <Collapse bordered={false}>
      {groups.map((group) => (
        <Collapse.Item key={group.id} name={group.id} header={t(`settings.material.group.${group.id}`)}>
          <div className='grid gap-14px'>
            {group.dials.map((key) => {
              const spec = dialSpec(key);
              return (
                <div key={key} className={styles.dial}>
                  <span className={styles.dialHead}>
                    <Typography.Text className='text-12px font-600 text-t-secondary'>
                      {t(`settings.material.dial.${key}`)}
                    </Typography.Text>
                    <span className={styles.value}>{formatDial(key, value(key))}</span>
                  </span>
                  <Slider
                    data-testid={`dial-${key}`}
                    value={value(key)}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    onChange={(next) => onMove(key, single(next))}
                    onAfterChange={(next) => onSettle(key, single(next))}
                  />
                  <Typography.Text className='text-11px leading-15px text-t-tertiary'>
                    {t(`settings.material.dialHint.${key}`)}
                  </Typography.Text>
                </div>
              );
            })}
          </div>
        </Collapse.Item>
      ))}
    </Collapse>
  );
};

export default DialGroups;
