-- Migration 034: rename the built-in butler and its skills onto our own name.
--
-- Two things are corrected here.
--
-- The assistant's display name and description are seeded from the embedded
-- manifest on first run only, so an install that already has the row keeps the
-- old name forever unless it is updated in place.
--
-- The built-in skills are materialised from embedded directories, and the sync
-- adds rows for directories it finds but never removes rows for directories
-- that disappeared. The previous rename proved it: `fool-config` was added and
-- `aionui-config` stayed behind, so the skill list showed both. Renaming the
-- remaining directories would repeat that, so the stale rows are dropped here.
-- They are `source = 'builtin'`, which means they are regenerated from the
-- binary's own assets — nothing the user created is touched.

UPDATE assistant_definitions
SET name = 'The Jester',
    name_i18n = json_set(
        COALESCE(NULLIF(name_i18n, ''), '{}'),
        '$."en-US"', 'The Jester',
        '$."zh-CN"', '弄臣',
        '$."ru-RU"', 'Шут',
        '$."uk-UA"', 'Блазень'
    )
WHERE assistant_id = 'fool-assistant'
  AND source = 'builtin';

UPDATE assistant_definitions
SET description = REPLACE(description, 'AionUi', 'The Fool'),
    description_i18n = REPLACE(COALESCE(NULLIF(description_i18n, ''), '{}'), 'AionUi', 'The Fool')
WHERE assistant_id = 'fool-assistant'
  AND source = 'builtin';

DELETE FROM skills
WHERE source = 'builtin'
  AND name IN (
      'aionui-config',
      'aionui-troubleshooting',
      'aionui-webui-public',
      'aionui-webui-setup'
  );
