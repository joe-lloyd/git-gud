// Pure ref-grouping logic for the commit graph's ref pills. Kept dependency-free
// (no React/CSS) so it can be unit-tested directly.

export interface RefGroup {
  key: string;
  name: string; // display name, e.g. "main"
  isHead: boolean; // HEAD points here
  hasLocal: boolean; // local branch with this name exists
  hasRemote: boolean; // remote/*/name exists
  isTag: boolean; // tag
  isGerritChange: boolean; // open Gerrit change (current or outdated patchset)
  isOutdatedPatchset: boolean; // an older patchset of an open change (not the current one)
  hasWorktree: boolean; // checked out in a worktree
  tooltip: string; // full list of raw refs
}

// Namespace GitService mirrors open Gerrit changes into (see gerrit-utils'
// CHANGE_REF_PREFIX — duplicated here because main-process modules can't be
// imported by the renderer).
export const GERRIT_CHANGE_REF_PREFIX = "refs/gitgud/changes/";

// Synthetic, renderer-only marker (never a real git ref): appended to a
// commit's refs by App when the commit is an OLD patchset of an open change
// that another commit still builds on — labeled instead of looking like an
// anonymous orphan node.
export const GERRIT_OUTDATED_REF_PREFIX = "refs/gitgud/outdated/";

const changeNumberFrom = (ref: string, prefix: string): number | null => {
  if (!ref.startsWith(prefix)) return null;
  const n = Number(ref.slice(prefix.length));
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The change number when `ref` is a mirrored Gerrit change ref, else null. */
export function gerritChangeNumber(ref: string): number | null {
  return changeNumberFrom(ref, GERRIT_CHANGE_REF_PREFIX);
}

/** The change number when `ref` is a synthetic outdated-patchset marker. */
export function gerritOutdatedNumber(ref: string): number | null {
  return changeNumberFrom(ref, GERRIT_OUTDATED_REF_PREFIX);
}

/** Extract the short branch name from any ref form. */
export function branchBaseName(ref: string): string {
  // remote ref: origin/main, upstream/feature/foo → take everything after first segment
  if (ref.includes("/")) {
    const parts = ref.split("/");
    // drop the remote name (first segment), rejoin the rest
    return parts.slice(1).join("/");
  }
  return ref;
}

/**
 * Groups the flat refs string array into logical ref groups.
 * E.g. ["HEAD", "main", "origin/main"] → one group {name:"main", isHead, hasLocal, hasRemote}
 * Tags stay as individual groups.
 */
export function groupRefs(refs: string[], worktreeBranches: Set<string>): RefGroup[] {
  const groups = new Map<string, RefGroup>();
  let headTarget: string | null = null;

  // First pass: find HEAD → branch mapping
  // git log --decorate gives "HEAD -> main" but our parser splits them into
  // separate strings: "HEAD" and "main". HEAD always appears right before
  // the branch it points to, so we track it separately.
  for (const ref of refs) {
    if (ref === "HEAD") {
      headTarget = "HEAD_standalone";
      continue;
    }
    if (ref.startsWith("tag: ")) continue;
    if (gerritChangeNumber(ref) !== null || gerritOutdatedNumber(ref) !== null) continue; // never HEAD's branch
    // The first non-HEAD, non-tag ref after HEAD is what HEAD points to
    if (headTarget === "HEAD_standalone") {
      headTarget = branchBaseName(ref);
      break;
    }
  }

  // Second pass: build groups
  for (const ref of refs) {
    if (ref === "HEAD") continue; // handled via headTarget
    // Skip remote symbolic-HEAD refs (`origin/HEAD`, `upstream/HEAD`). They
    // mirror the remote's default branch — already shown via that branch's
    // own ref, so the bare HEAD pill is noise.
    if (ref.endsWith("/HEAD")) continue;

    if (ref.startsWith("tag: ")) {
      const tagName = ref.slice(5);
      groups.set(ref, {
        key: ref,
        name: tagName,
        isHead: false,
        hasLocal: false,
        hasRemote: false,
        isTag: true,
        isGerritChange: false,
        isOutdatedPatchset: false,
        hasWorktree: false,
        tooltip: ref,
      });
      continue;
    }

    // Mirrored open Gerrit change — its own pill kind, shown as "#<number>".
    const changeNumber = gerritChangeNumber(ref);
    if (changeNumber !== null) {
      groups.set(ref, {
        key: ref,
        name: `#${changeNumber}`,
        isHead: false,
        hasLocal: false,
        hasRemote: false,
        isTag: false,
        isGerritChange: true,
        isOutdatedPatchset: false,
        hasWorktree: false,
        tooltip: `open Gerrit change #${changeNumber} — current patchset`,
      });
      continue;
    }

    // Older patchset of an open change (synthetic marker from App) — labeled
    // so the node doesn't read as an anonymous orphan.
    const outdatedNumber = gerritOutdatedNumber(ref);
    if (outdatedNumber !== null) {
      groups.set(ref, {
        key: ref,
        name: `#${outdatedNumber}`,
        isHead: false,
        hasLocal: false,
        hasRemote: false,
        isTag: false,
        isGerritChange: true,
        isOutdatedPatchset: true,
        hasWorktree: false,
        tooltip: `outdated patchset of open Gerrit change #${outdatedNumber} — a newer patchset exists`,
      });
      continue;
    }

    const base = branchBaseName(ref);
    const isRemote = ref.includes("/") && !ref.startsWith("HEAD");

    if (!groups.has(base)) {
      groups.set(base, {
        key: base,
        name: base,
        isHead: base === headTarget,
        hasLocal: !isRemote,
        hasRemote: isRemote,
        isTag: false,
        isGerritChange: false,
        isOutdatedPatchset: false,
        hasWorktree: worktreeBranches.has(base),
        tooltip: ref,
      });
    } else {
      const g = groups.get(base)!;
      if (isRemote) g.hasRemote = true;
      else g.hasLocal = true;
      g.tooltip += `, ${ref}`;
    }
  }

  // If HEAD was standalone (detached), add a HEAD group
  if (headTarget === "HEAD_standalone") {
    groups.set("HEAD", {
      key: "HEAD",
      name: "HEAD",
      isHead: true,
      hasLocal: false,
      hasRemote: false,
      isTag: false,
      isGerritChange: false,
      isOutdatedPatchset: false,
      hasWorktree: false,
      tooltip: "HEAD (detached)",
    });
  }

  return Array.from(groups.values());
}

/**
 * The single most meaningful pill to surface when a commit has several refs:
 * current HEAD, else a local branch, else a tag, else whatever's first.
 */
export function pickPrimaryRefGroup(groups: RefGroup[]): RefGroup | undefined {
  return (
    groups.find((g) => g.isHead) ??
    groups.find((g) => g.hasLocal && !g.isTag) ??
    groups.find((g) => g.isTag) ??
    groups[0]
  );
}
