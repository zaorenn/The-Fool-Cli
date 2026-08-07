/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Empty, Typography } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { configService } from '@/common/config/configService';
import { LOCAL_SKILLS_CONFIG_KEY, type LocalSkill } from '@/common/voice/localSkills';
import { forgetLocalSkill, peekLocalSkills } from '@renderer/services/voice/session/localSkillStore';

/**
 * Everything the assistant taught itself to do, where it can be read and undone.
 *
 * These are the one kind of thing in the memory that *acts*. A fact read wrongly
 * makes for an awkward sentence; a skill is an address or a program the app will
 * open when a phrase is said, written into existence by a model during a
 * conversation. Something that can act has to be visible, and it has to be
 * possible to take away — a capability the user cannot see is one they cannot
 * withdraw.
 *
 * So the target is shown in full rather than summarised. "Opens a page" tells
 * somebody nothing they could act on; the actual address is the only version of
 * that sentence they can check.
 */

const targetOf = (skill: LocalSkill): string =>
  skill.action.kind === 'open-url' ? skill.action.url : skill.action.path;

const LocalSkillList: React.FC = () => {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<LocalSkill[]>(() => peekLocalSkills());

  useEffect(() => {
    const read = (): void => setSkills(peekLocalSkills());
    read();
    // Taught during a conversation that may be happening in another window, so
    // this follows the store rather than reading once.
    return configService.subscribe(LOCAL_SKILLS_CONFIG_KEY, read);
  }, []);

  const drop = async (skill: LocalSkill): Promise<void> => {
    await forgetLocalSkill(skill.name);
    setSkills(peekLocalSkills());
  };

  return (
    <div className='grid gap-10px'>
      <Typography.Text className='text-12px leading-19px text-t-tertiary'>
        {t('settings.memory.skillsHint')}
      </Typography.Text>

      {skills.length === 0 ? (
        <Empty description={t('settings.memory.skillsEmpty')} />
      ) : (
        <div className='grid gap-8px'>
          {skills.map((skill) => (
            <div
              key={skill.id}
              className='grid gap-2px rounded-8px border border-line bg-fill-1 px-12px py-10px'
              data-testid={`local-skill-${skill.id}`}
            >
              <div className='flex items-start justify-between gap-8px'>
                <Typography.Text className='text-13px font-600 text-t-primary'>{skill.name}</Typography.Text>
                <Button
                  type='text'
                  size='mini'
                  icon={<Delete size={13} />}
                  aria-label={t('common.delete')}
                  onClick={() => void drop(skill)}
                />
              </div>
              <Typography.Text className='text-12px text-t-secondary'>{skill.when}</Typography.Text>
              {/* The real target, unabridged. Breaking on any character because a
                  path or a query string has no spaces to break on and a truncated
                  one is not something anybody can check. */}
              <Typography.Text className='text-11px text-t-tertiary [overflow-wrap:anywhere]'>
                {t(`settings.memory.skillAction.${skill.action.kind}`)} — {targetOf(skill)}
              </Typography.Text>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LocalSkillList;
