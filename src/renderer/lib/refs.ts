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

// Namespaces GitService mirrors open Gerrit changes into (see gerrit-utils'
// CHANGE_REF_PREFIX / PATCHSET_REF_PREFIX — duplicated here because
// main-process modules can't be imported by the renderer). The current
// patchset of change <n> is refs/gitgud/changes/<n>; older patchsets, walked
// only in the "all patch sets" graph mode, are refs/gitgud/patchsets/<n>/<ps>.
export const GERRIT_CHANGE_REF_PREFIX = "refs/gitgud/changes/";
export const GERRIT_PATCHSET_REF_PREFIX = "refs/gitgud/patchsets/";

// Synthetic, renderer-only marker (never a real git ref): appended to a
// commit's refs by App when the commit is an OLD patchset of an open change
// that another commit still builds on — labeled instead of looking like an
// anonymous orphan node. Carries the patchset number when known:
// refs/gitgud/outdated/<n>[/<ps>].
export const GERRIT_OUTDATED_REF_PREFIX = "refs/gitgud/outdated/";

const positiveInt = (s: string): number | null => {
  const n = Number(s);
  return /^\d+$/.test(s) && Number.isInteger(n) && n > 0 ? n : null;
};

const changeNumberFrom = (ref: string, prefix: string): number | null => {
  if (!ref.startsWith(prefix)) return null;
  return positiveInt(ref.slice(prefix.length));
};

/** `<n>[/<ps>]` after `prefix` → change number + optional patchset number. */
const changePatchsetFrom = (
  ref: string,
  prefix: string,
): { number: number; patchset: number | null } | null => {
  if (!ref.startsWith(prefix)) return null;
  const [n, ps, ...rest] = ref.slice(prefix.length).split("/");
  if (rest.length > 0) return null;
  const number = positiveInt(n ?? "");
  if (number === null) return null;
  if (ps === undefined) return { number, patchset: null };
  const patchset = positiveInt(ps);
  return patchset === null ? null : { number, patchset };
};

/** The change number when `ref` is a mirrored Gerrit change ref, else null. */
export function gerritChangeNumber(ref: string): number | null {
  return changeNumberFrom(ref, GERRIT_CHANGE_REF_PREFIX);
}

/** The change number when `ref` is a synthetic outdated-patchset marker. */
export function gerritOutdatedNumber(ref: string): number | null {
  return changePatchsetFrom(ref, GERRIT_OUTDATED_REF_PREFIX)?.number ?? null;
}

/**
 * Change + patchset numbers when `ref` is an older patchset of an open change:
 * a real mirrored refs/gitgud/patchsets/<n>/<ps> ref, or App's synthetic
 * refs/gitgud/outdated/<n>[/<ps>] marker. Else null.
 */
export function gerritOlderPatchset(ref: string): { number: number; patchset: number | null } | null {
  return (
    changePatchsetFrom(ref, GERRIT_PATCHSET_REF_PREFIX) ??
    changePatchsetFrom(ref, GERRIT_OUTDATED_REF_PREFIX)
  );
}

/** True for any mirrored older-patchset ref (not the synthetic marker). */
export function isGerritPatchsetRef(ref: string): boolean {
  return changePatchsetFrom(ref, GERRIT_PATCHSET_REF_PREFIX)?.patchset != null;
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
    if (gerritChangeNumber(ref) !== null || gerritOlderPatchset(ref) !== null) continue; // never HEAD's branch
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

    // Older patchset of an open change — a mirrored refs/gitgud/patchsets
    // ref ("all patch sets" mode) or App's synthetic marker — labeled so the
    // node doesn't read as an anonymous orphan. "#1234 PS3" when the
    // patchset number is known.
    const older = gerritOlderPatchset(ref);
    if (older !== null) {
      const ps = older.patchset !== null ? ` PS${older.patchset}` : "";
      groups.set(ref, {
        key: ref,
        name: `#${older.number}${ps}`,
        isHead: false,
        hasLocal: false,
        hasRemote: false,
        isTag: false,
        isGerritChange: true,
        isOutdatedPatchset: true,
        hasWorktree: false,
        tooltip: `${older.patchset !== null ? `patchset ${older.patchset}` : "older patchset"} of open Gerrit change #${older.number} — a newer patchset exists`,
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
