// What the commit graph shows: which ref pills get drawn, and whether the log
// walks tool-private ref namespaces (T3 Chat checkpoints, refs/notes, …) at
// all. Pure (no React/DOM) so it can be unit-tested directly; the persisted
// state lives in hooks/useRefVisibility.

import { RefGroup } from "./refs";

export interface RefVisibility {
  /**
   * Walk ref namespaces outside branches/tags/remotes/stash — refs/t3/*,
   * refs/notes, jj scratch refs. Off by default: those commits are nobody's
   * branch and just add lanes and undecorated nodes to the tree.
   */
  otherRefs: boolean;
  /** Local branch pills (and the detached-HEAD marker). */
  local: boolean;
  /** Remote-tracking branch pills (origin/…). */
  remote: boolean;
  tags: boolean;
  /** Mirrored Gerrit change pills (#1234), current and outdated patchsets. */
  gerrit: boolean;
}

export const DEFAULT_REF_VISIBILITY: RefVisibility = {
  otherRefs: false,
  local: true,
  remote: true,
  tags: true,
  gerrit: true,
};

/** Pill kinds toggled individually in the toolbar menu. */
export const REF_KINDS = ["local", "remote", "tags", "gerrit"] as const;
export type RefKind = (typeof REF_KINDS)[number];

/** True when a group survives the current filter. */
export function isRefGroupVisible(g: RefGroup, vis: RefVisibility): boolean {
  if (g.isTag) return vis.tags;
  if (g.isGerritChange) return vis.gerrit;
  // A branch group can carry both a local and a remote ref — keep it while
  // either side is still shown. Groups with neither (detached HEAD) count as
  // local, so hiding "local" hides the HEAD pill too.
  if (g.hasLocal && vis.local) return true;
  if (g.hasRemote && vis.remote) return true;
  return !g.hasLocal && !g.hasRemote && vis.local;
}

export function filterRefGroups(groups: RefGroup[], vis: RefVisibility): RefGroup[] {
  return groups.filter((g) => isRefGroupVisible(g, vis));
}

/** True only when every pill kind is off — the refs column collapses. */
export function refsColumnHidden(vis: RefVisibility): boolean {
  return REF_KINDS.every((k) => !vis[k]);
}

/** Tolerant read of a persisted blob — unknown/missing fields fall back. */
export function normalizeRefVisibility(raw: unknown): RefVisibility {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_REF_VISIBILITY };
  const o = raw as Partial<Record<keyof RefVisibility, unknown>>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    otherRefs: bool(o.otherRefs, DEFAULT_REF_VISIBILITY.otherRefs),
    local: bool(o.local, DEFAULT_REF_VISIBILITY.local),
    remote: bool(o.remote, DEFAULT_REF_VISIBILITY.remote),
    tags: bool(o.tags, DEFAULT_REF_VISIBILITY.tags),
    gerrit: bool(o.gerrit, DEFAULT_REF_VISIBILITY.gerrit),
  };
}
