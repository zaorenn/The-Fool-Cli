-- Migration 035: move the built-in assistant off the previous vendor's id.
--
-- `assistant_id` is the logical identity the manifest seeds against, and the
-- row also stores the asset paths it was seeded with. The embedded assets were
-- renamed alongside this, so a row left on the old id would seed a duplicate
-- assistant and point its avatar and rule file at files that no longer exist.
--
-- `assistant_definitions.id` is a separate surrogate UUID, which is what
-- `assistant_overlays` and `assistant_preferences` reference — a user's
-- enable/disable state and last-used model survive this untouched.
--
-- Guarded on the destination being free: a partial unique index covers
-- (assistant_id) for global rows, so on a database that already carries the
-- new id this is a no-op rather than a failed migration.

UPDATE assistant_definitions
SET assistant_id = 'fool-assistant',
    avatar_value = REPLACE(COALESCE(avatar_value, ''), 'aionui-assistant', 'fool-assistant'),
    rule_resource_ref = REPLACE(COALESCE(rule_resource_ref, ''), 'aionui-assistant', 'fool-assistant')
WHERE assistant_id = 'aionui-assistant'
  AND NOT EXISTS (
      SELECT 1
      FROM assistant_definitions AS taken
      WHERE taken.assistant_id = 'fool-assistant'
        AND (
            (taken.user_id IS NULL AND assistant_definitions.user_id IS NULL)
            OR taken.user_id = assistant_definitions.user_id
        )
  );

UPDATE assistant_overrides
SET assistant_id = 'fool-assistant'
WHERE assistant_id = 'aionui-assistant'
  AND NOT EXISTS (
      SELECT 1
      FROM assistant_overrides AS taken
      WHERE taken.assistant_id = 'fool-assistant'
        AND taken.user_id = assistant_overrides.user_id
  );
