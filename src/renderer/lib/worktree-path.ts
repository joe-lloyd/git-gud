// Default worktree path derivation. Worktrees live in a sibling folder of the
// project: `‹project›.worktrees/`. Pure + unit-testable.

/** Base folder for a project's worktrees: `/a/b/proj` → `/a/b/proj.worktrees`. */
export function worktreeBaseFor(projectPath: string): string {
  if (!projectPath) return "";
  const p = projectPath.replace(/\/+$/, "");
  const slash = p.lastIndexOf("/");
  const parent = slash >= 0 ? p.slice(0, slash) : "";
  const name = slash >= 0 ? p.slice(slash + 1) : p;
  return `${parent}/${name}.worktrees`;
}

/**
 * Full default path for a new worktree on `branch`:
 * `/a/b/proj` + `feature/x` → `/a/b/proj.worktrees/feature/x`.
 * Returns "" when there's no project path or branch.
 */
export function defaultWorktreePath(projectPath: string, branch: string): string {
  const base = worktreeBaseFor(projectPath);
  return base && branch ? `${base}/${branch}` : "";
}
