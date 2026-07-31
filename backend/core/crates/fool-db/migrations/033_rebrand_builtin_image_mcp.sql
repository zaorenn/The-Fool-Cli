-- Migration 033: move the built-in image generation MCP server onto our name.
--
-- The name is not decorative: the desktop reconciles this row by exact name on
-- every start, and the agent sees it as the tool server's name. Renaming the
-- constant without moving the row would leave the old row in place and add a
-- second one beside it, so the user would see the built-in server twice.
--
-- Guarded on the destination being free because `mcp_servers` is UNIQUE on
-- (user_id, name) — on a database that already has the new name this is a
-- no-op rather than a failed migration.

UPDATE mcp_servers
SET name = 'fool-image-generation',
    original_json = REPLACE(original_json, 'aionui-image-generation', 'fool-image-generation')
WHERE name = 'aionui-image-generation'
  AND NOT EXISTS (
      SELECT 1
      FROM mcp_servers AS taken
      WHERE taken.name = 'fool-image-generation'
        AND taken.user_id = mcp_servers.user_id
  );
