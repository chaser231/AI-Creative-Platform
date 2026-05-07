-- Adds support for `visibility = 'global'` on AIPreset (visible to every user
-- across all workspaces, settable only by SUPER_ADMIN).
-- The column type stays TEXT — existing 'personal' / 'workspace' rows untouched.

-- Switch the default to "personal" (least privilege). Existing rows keep their
-- explicit value; only new rows that omit `visibility` are affected.
ALTER TABLE "AIPreset" ALTER COLUMN "visibility" SET DEFAULT 'personal';

-- Cross-workspace lookup of global presets in ai.listPresets. The existing
-- composite index leads with workspaceId so it isn't usable for the global
-- branch of the OR query.
CREATE INDEX IF NOT EXISTS "AIPreset_visibility_type_isActive_idx"
  ON "AIPreset" ("visibility", "type", "isActive");
