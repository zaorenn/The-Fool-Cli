import { describe, expect, it } from 'vitest';
import { findLocalSkill, type LocalSkill } from '@/common/voice/localSkills';

const skill = (name: string): LocalSkill => ({ name, id: name.toLowerCase() }) as LocalSkill;

const skills = [skill('Favourite song'), skill('Favori şarkı')];

/**
 * What this function is now for, and what it is not.
 *
 * It resolves the name the *model* passed to `app_skill_do` against the skills
 * the user taught, loosely, because a model repeating a name from a listing
 * gets the wording approximately right. It is no longer run over raw speech to
 * decide whether a skill should fire — that shortcut played a song whenever its
 * trigger appeared anywhere in a sentence, including sentences whose point was
 * something else entirely.
 */
describe('findLocalSkill, as the tool resolves a name', () => {
  it('resolves an exact name', () => {
    expect(findLocalSkill(skills, 'favourite song')?.name).toBe('Favourite song');
  });

  it('resolves a name the model wrote out slightly differently', () => {
    expect(findLocalSkill(skills, 'play my favourite song')?.name).toBe('Favourite song');
  });

  it('resolves a Turkish name', () => {
    expect(findLocalSkill(skills, 'favori şarkı')?.name).toBe('Favori şarkı');
  });

  it('finds nothing rather than guessing at a name it was never taught', () => {
    expect(findLocalSkill(skills, 'order me a pizza')).toBeNull();
  });

  it('finds nothing for an empty name', () => {
    expect(findLocalSkill(skills, '   ')).toBeNull();
  });
});
