-- Migration 031: move the built-in agent onto this project's own name.
--
-- Migrations 001 through 030 are already recorded in `_sqlx_migrations` with
-- their checksums, so the rows they seeded are corrected here rather than at
-- source. On a fresh database this runs straight after 001 has inserted them and
-- reaches the same end state, which is why the update is written to match on the
-- old value instead of on the agent id alone.
--
-- The identifier is what the desktop app sends as a conversation type and reads
-- back from the agent catalog, so the two must change together; the name and the
-- icon are what a user actually reads.

UPDATE agent_metadata
SET agent_type = 'foolrs'
WHERE agent_type = 'aionrs';

UPDATE agent_metadata
SET name = 'The Fool CLI'
WHERE agent_type = 'foolrs'
  AND name = 'Aion CLI';

UPDATE agent_metadata
SET icon = '/api/assets/logos/brand/fool.png'
WHERE icon = '/api/assets/logos/brand/aion.svg';

-- The skills directory the built-in agent loads from, renamed with it.
UPDATE agent_metadata
SET native_skills_dirs = '[".foolrs/skills"]'
WHERE native_skills_dirs = '[".aionrs/skills"]';

-- Conversations already recorded against the old identifier keep working.
UPDATE conversations
SET type = 'foolrs'
WHERE type = 'aionrs';
