-- Workspaces used to be named after their branch. They are now numbered per
-- project — "Workspace 1", "Workspace 2" — and renamed by hand.
--
-- Only workspaces still carrying an auto-generated name (is_unnamed = 1) are
-- touched. A name someone chose is theirs, and a schema change is not an
-- invitation to throw it away.
--
-- Numbering follows creation order so the oldest workspace is 1, and runs per
-- project so every project starts at 1 rather than continuing a global count.
UPDATE workspaces
SET name = 'Workspace ' || (
    SELECT COUNT(*)
    FROM workspaces AS earlier
    WHERE earlier.project_id = workspaces.project_id
      AND earlier.type = 'worktree'
      AND earlier.is_unnamed = 1
      AND earlier.deleting_at IS NULL
      AND (
        earlier.created_at < workspaces.created_at
        OR (earlier.created_at = workspaces.created_at AND earlier.id <= workspaces.id)
      )
  )
WHERE type = 'worktree'
  AND is_unnamed = 1
  AND deleting_at IS NULL;
