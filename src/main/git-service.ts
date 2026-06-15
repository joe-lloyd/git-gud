import simpleGit, {
  SimpleGit,
  LogResult,
  StatusResult,
} from "simple-git";

export interface CommitNode {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  email: string;
  date: string;
  timestamp: number;
  parents: string[];
  refs: string[]; // branch/tag labels attached to this commit
}

export interface BranchInfo {
  name: string;
  current: boolean;
  sha: string;
  remote?: string;
}

export interface BranchData {
  local: BranchInfo[];
  remote: BranchInfo[];
}

export interface TagInfo {
  name: string;
  sha: string;
}

export interface StashInfo {
  index: number;
  message: string;
  sha: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  sha: string;
  isMain: boolean;
}

export interface FileChange {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}

export interface RepoStatus {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
  branch: string;
  ahead: number;
  behind: number;
  conflict?: ConflictState;
}

export interface ConflictState {
  inMerge: boolean;
  inRebase: boolean;
  rebaseKind?: "apply" | "merge";
  conflictedFiles: string[];
}

export type ConflictSection =
  | { kind: "shared"; text: string }
  | { kind: "conflict"; current: string; incoming: string; currentLabel: string; incomingLabel: string };

export interface CommitOpts {
  subject: string;
  body?: string;
  noVerify?: boolean;
  signoff?: boolean;
}

export class GitService {
  private git: SimpleGit;
  private repoPath: string;
  private getToken?: () => string | null;

  constructor(repoPath: string, getToken?: () => string | null) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
    this.getToken = getToken;
  }

  private getAuthConfigs(): string[] {
    const token = this.getToken?.();
    if (!token) return [];
    const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
    return [
      "-c",
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${b64}`,
    ];
  }

  async isRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  async getLog(limit = 500): Promise<CommitNode[]> {
    // Use ASCII unit-separator \x1f between fields so empty %D never collapses
    // into the message line (which happens with newline-only separators).
    const FS = "\x1f";

    // Older stashes live only in the reflog of refs/stash, so --all wouldn't
    // pick them up. Pass each stash SHA explicitly to include the whole stack.
    let extraRefs: string[] = [];
    try {
      const stashRaw = await this.git.raw(["stash", "list", "--format=%H"]);
      extraRefs = stashRaw.trim().split("\n").filter(Boolean);
    } catch {
      /* no stashes */
    }

    const rawOutput = await this.git.raw([
      "log",
      `--max-count=${limit}`,
      "--all",
      "--parents",
      // --date-order still guarantees child-before-parent (the lane
      // algorithm's invariant) but interleaves branches by commit time, so
      // a feature commit merged later doesn't surface above older mainline
      // history the way --topo-order would group it.
      "--date-order",
      `--format=COMMIT_SEP%n%H${FS}%P${FS}%an${FS}%ae${FS}%aI${FS}%D${FS}%s`,
      ...extraRefs,
    ]);
    return parseRawLog(rawOutput);
  }

  async getBranches(): Promise<BranchData> {
    // simple-git's branch summary returns short SHAs; the graph keys rows by
    // full SHA, so clicks wouldn't scroll-to-commit. Use for-each-ref for full
    // SHAs and read HEAD separately to flag the current branch.
    const [refsRaw, headRaw] = await Promise.all([
      this.git.raw([
        "for-each-ref",
        "--format=%(refname)\x1f%(objectname)",
        "refs/heads",
        "refs/remotes",
      ]),
      this.git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ""),
    ]);
    const currentBranch = headRaw.trim();

    const local: BranchInfo[] = [];
    const remote: BranchInfo[] = [];

    for (const line of refsRaw.trim().split("\n").filter(Boolean)) {
      const [refname, sha] = line.split("\x1f");
      if (refname.startsWith("refs/heads/")) {
        const name = refname.slice("refs/heads/".length);
        local.push({ name, current: name === currentBranch, sha });
      } else if (refname.startsWith("refs/remotes/")) {
        const name = refname.slice("refs/remotes/".length);
        if (name.endsWith("/HEAD")) continue;
        remote.push({ name, current: false, sha });
      }
    }

    return { local, remote };
  }

  async getTags(): Promise<TagInfo[]> {
    try {
      // %(*objectname) dereferences annotated tags to the commit they point at;
      // empty for lightweight tags, where %(objectname) is already the commit.
      const raw = await this.git.raw([
        "for-each-ref",
        "--format=%(refname:short)\x1f%(objectname)\x1f%(*objectname)",
        "refs/tags",
      ]);
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name, obj, deref] = line.split("\x1f");
          return { name, sha: deref || obj };
        });
    } catch {
      return [];
    }
  }

  async getStashes(): Promise<StashInfo[]> {
    try {
      const raw = await this.git.raw(["stash", "list", "--format=%gd %H %gs"]);
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line, i) => {
          const match = line.match(/stash@\{(\d+)\}\s+([0-9a-f]+)\s+(.+)/);
          return {
            index: match ? parseInt(match[1]) : i,
            sha: match ? match[2] : "",
            message: match ? match[3] : line,
          };
        });
    } catch {
      return [];
    }
  }

  async getStatus(): Promise<RepoStatus> {
    const status: StatusResult = await this.git.status();
    let ahead = 0;
    let behind = 0;
    try {
      const trackingRaw = await this.git.raw([
        "rev-list",
        "--left-right",
        "--count",
        `${status.current}...@{u}`,
      ]);
      const parts = trackingRaw.trim().split(/\s+/);
      ahead = parseInt(parts[0]) || 0;
      behind = parseInt(parts[1]) || 0;
    } catch {
      /* no upstream */
    }

    // Fetch line numbers
    const parseNumstat = (raw: string) => {
      const stats: Record<string, { add: number; del: number }> = {};
      for (const line of raw.trim().split("\n").filter(Boolean)) {
        const [a, d, p] = line.split(/\t+/);
        stats[p] = { add: parseInt(a) || 0, del: parseInt(d) || 0 };
      }
      return stats;
    };

    let stagedStats: Record<string, { add: number; del: number }> = {};
    let unstagedStats: Record<string, { add: number; del: number }> = {};
    try {
      const [stagedRaw, unstagedRaw] = await Promise.all([
        this.git.raw(["diff", "--cached", "--numstat"]),
        this.git.raw(["diff", "--numstat"]),
      ]);
      stagedStats = parseNumstat(stagedRaw);
      unstagedStats = parseNumstat(unstagedRaw);
    } catch {
      /* ignore numstat errors */
    }

    const staged: FileChange[] = [];
    const unstaged: FileChange[] = [];

    for (const file of status.files) {
      if (file.index && file.index !== " " && file.index !== "?") {
        staged.push({
          path: file.path,
          status: file.index,
          additions: stagedStats[file.path]?.add,
          deletions: stagedStats[file.path]?.del,
        });
      }
      if (
        file.working_dir &&
        file.working_dir !== " " &&
        file.working_dir !== "?"
      ) {
        unstaged.push({
          path: file.path,
          status: file.working_dir,
          additions: unstagedStats[file.path]?.add,
          deletions: unstagedStats[file.path]?.del,
        });
      }
    }

    return {
      staged,
      unstaged,
      untracked: status.not_added,
      branch: status.current || "HEAD",
      ahead,
      behind,
      conflict: await this.getConflictState(),
    };
  }

  // Detect mid-flight merge/rebase + enumerate unmerged paths. Reads .git
  // sentinel directories directly — these are the same files git itself uses
  // to know "we're paused". `conflictedFiles` may be empty while inMerge or
  // inRebase is true: that's the "everything resolved, awaiting --continue"
  // state.
  async getConflictState(): Promise<ConflictState> {
    const path = await import("path");
    const fs = await import("fs/promises");
    const gitDir = path.join(this.repoPath, ".git");
    const exists = async (p: string) => {
      try { await fs.access(p); return true; } catch { return false; }
    };
    const [inMerge, rebaseMerge, rebaseApply] = await Promise.all([
      exists(path.join(gitDir, "MERGE_HEAD")),
      exists(path.join(gitDir, "rebase-merge")),
      exists(path.join(gitDir, "rebase-apply")),
    ]);
    const inRebase = rebaseMerge || rebaseApply;
    const rebaseKind = rebaseMerge ? "merge" : rebaseApply ? "apply" : undefined;

    let conflictedFiles: string[] = [];
    if (inMerge || inRebase) {
      try {
        const raw = await this.git.raw(["diff", "--name-only", "--diff-filter=U"]);
        conflictedFiles = raw.trim().split("\n").filter(Boolean);
      } catch { /* no diff yet */ }
    }
    return { inMerge, inRebase, rebaseKind, conflictedFiles };
  }

  // Staging a previously-conflicted file is git's way of marking it resolved.
  async markResolved(files: string[]): Promise<void> {
    await this.git.add(files);
  }

  // Read a conflicted file and split it into shared sections and conflict
  // blocks. Markers come straight from git: `<<<<<<< X` … `=======` … `>>>>>>> Y`.
  // The labels after the chevrons usually identify which side is which
  // (HEAD vs the incoming branch / commit being replayed).
  async getConflictFile(filePath: string): Promise<{ path: string; sections: ConflictSection[] }> {
    const path = await import("path");
    const fsp = await import("fs/promises");
    const raw = await fsp.readFile(path.join(this.repoPath, filePath), "utf8");
    const sections: ConflictSection[] = [];
    const lines = raw.split("\n");
    let i = 0;
    let sharedBuf: string[] = [];
    const flushShared = () => {
      if (sharedBuf.length === 0) return;
      sections.push({ kind: "shared", text: sharedBuf.join("\n") });
      sharedBuf = [];
    };
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("<<<<<<<")) {
        flushShared();
        const currentLabel = line.slice(8).trim() || "current";
        const currentLines: string[] = [];
        const incomingLines: string[] = [];
        i++;
        // Read until separator, capturing "current" (HEAD/ours)
        while (i < lines.length && !lines[i].startsWith("=======")) {
          currentLines.push(lines[i]);
          i++;
        }
        // Skip the `=======` line
        i++;
        // Read until closing marker, capturing "incoming" (theirs)
        while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
          incomingLines.push(lines[i]);
          i++;
        }
        const incomingLabel = i < lines.length ? lines[i].slice(8).trim() || "incoming" : "incoming";
        i++; // consume closing marker
        sections.push({
          kind: "conflict",
          current: currentLines.join("\n"),
          incoming: incomingLines.join("\n"),
          currentLabel,
          incomingLabel,
        });
      } else {
        sharedBuf.push(line);
        i++;
      }
    }
    flushShared();
    return { path: filePath, sections };
  }

  // Write user-chosen content back to disk. Used by ConflictEditor before
  // marking the file resolved.
  async writeFileContent(filePath: string, content: string): Promise<void> {
    const path = await import("path");
    const fsp = await import("fs/promises");
    await fsp.writeFile(path.join(this.repoPath, filePath), content, "utf8");
  }

  async rebaseContinue(): Promise<{ success: boolean; error?: string }> {
    try {
      // GIT_EDITOR=true keeps the rebase from opening an interactive editor for
      // the commit message — accept whatever git proposes.
      await this.git.env({ ...process.env, GIT_EDITOR: "true" }).raw(["rebase", "--continue"]);
      return { success: true };
    } catch (e) { return { success: false, error: String(e) }; }
  }
  async rebaseAbort(): Promise<{ success: boolean; error?: string }> {
    try { await this.git.raw(["rebase", "--abort"]); return { success: true }; }
    catch (e) { return { success: false, error: String(e) }; }
  }
  async rebaseSkip(): Promise<{ success: boolean; error?: string }> {
    try { await this.git.raw(["rebase", "--skip"]); return { success: true }; }
    catch (e) { return { success: false, error: String(e) }; }
  }
  async mergeContinue(): Promise<{ success: boolean; error?: string }> {
    try {
      // After all conflicts are staged, `git commit --no-edit` finalizes the
      // merge with the auto-generated MERGE_MSG.
      await this.git.env({ ...process.env, GIT_EDITOR: "true" }).raw(["commit", "--no-edit"]);
      return { success: true };
    } catch (e) { return { success: false, error: String(e) }; }
  }
  async mergeAbort(): Promise<{ success: boolean; error?: string }> {
    try { await this.git.raw(["merge", "--abort"]); return { success: true }; }
    catch (e) { return { success: false, error: String(e) }; }
  }

  async getCommitDiff(sha: string): Promise<string> {
    return this.git.raw(["show", "--stat", "-p", "--format=", sha]);
  }

  /**
   * Parent SHAs for a commit. Merge commits have ≥ 2; everything else has ≤ 1.
   * Used to decide whether to compare against the first parent (merge view).
   */
  private async getParents(sha: string): Promise<string[]> {
    try {
      const out = await this.git.raw(["show", "-s", "--format=%P", sha]);
      return out.trim().split(/\s+/).filter(Boolean);
    } catch {
      return [];
    }
  }

  async getCommitFileDiff(sha: string, filePath: string, opts: { wordDiff?: boolean } = {}): Promise<string> {
    try {
      const wd = opts.wordDiff ? ["--word-diff=porcelain"] : [];
      const parents = await this.getParents(sha);
      if (parents.length > 1) {
        // Merge commit — `git show` collapses to nothing by default. Diff the
        // first parent vs the merge so we see what mainline gained.
        return await this.git.raw([
          "diff",
          "--unified=5",
          ...wd,
          `${sha}^1`,
          sha,
          "--",
          filePath,
        ]);
      }
      return await this.git.raw([
        "show",
        "--format=",
        "--unified=5",
        ...wd,
        sha,
        "--",
        filePath,
      ]);
    } catch {
      return "";
    }
  }

  async getFileDiff(filePath: string, staged: boolean, opts: { wordDiff?: boolean } = {}): Promise<string> {
    try {
      const wd = opts.wordDiff ? ["--word-diff=porcelain"] : [];
      const args = staged
        ? ["diff", "--cached", "--unified=5", ...wd, "--", filePath]
        : ["diff", "--unified=5", ...wd, "--", filePath];
      const result = await this.git.raw(args);
      if (!result.trim()) {
        // Untracked file — show full content as +lines
        const { readFileSync } = await import("fs");
        const { join } = await import("path");
        const content = readFileSync(join(this.repoPath, filePath), "utf8");
        const lines = content
          .split("\n")
          .map((l) => `+${l}`)
          .join("\n");
        return `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1 @@\n${lines}`;
      }
      return result;
    } catch {
      return "";
    }
  }

  async getCommitFiles(sha: string): Promise<FileChange[]> {
    const parents = await this.getParents(sha);
    // For a merge commit, the default diff-tree output is empty. Compare
    // against the first parent so the user sees exactly what this merge
    // brought into the destination branch.
    const args =
      parents.length > 1
        ? [
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--name-status",
            `${sha}^1`,
            sha,
          ]
        : ["diff-tree", "--no-commit-id", "-r", "--name-status", sha];
    const raw = await this.git.raw(args);
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split("\t");
        return { path: pathParts.join("\t"), status: status.trim() };
      });
  }

  async getRemotes(): Promise<{ name: string; url: string }[]> {
    try {
      const raw = await this.git.raw(["remote", "-v"]);
      const remotesMap = new Map<string, string>();
      for (const line of raw.split("\n")) {
        const match = line.match(/^(\S+)\s+(.+?)\s+\((fetch|push)\)$/);
        if (match) remotesMap.set(match[1], match[2]);
      }
      return Array.from(remotesMap.entries()).map(([name, url]) => ({
        name,
        url,
      }));
    } catch {
      return [];
    }
  }

  // Checkout returns the same kinds as pull so the renderer can offer the
  // same autostash recovery.
  async checkout(
    branch: string,
  ): Promise<{ success: boolean; error?: string; kind?: string }> {
    try {
      await this.git.checkout(branch);
      return { success: true };
    } catch (e: unknown) {
      const msg = String(e);
      return { success: false, error: msg, kind: classifyPullError(msg) };
    }
  }

  // Stash → checkout. We deliberately don't pop on the destination branch —
  // popping risks conflicts on a different tree and surprises the user mid-
  // switch. The stash is named so the user can find it in the sidebar and
  // pop manually when they're ready.
  async checkoutAutostash(branch: string): Promise<{ success: boolean; error?: string; stashMessage?: string }> {
    const stashMsg = `autostash before checkout to ${branch}`;
    try {
      await this.git.raw(["stash", "push", "--include-untracked", "-m", stashMsg]);
    } catch (e) {
      return { success: false, error: `stash failed: ${String(e)}` };
    }
    try {
      await this.git.checkout(branch);
      return { success: true, stashMessage: stashMsg };
    } catch (e) {
      // Checkout failed after the stash — restore so the user isn't stranded.
      try { await this.git.raw(["stash", "pop"]); } catch { /* leave on stack */ }
      return { success: false, error: `checkout failed: ${String(e)}` };
    }
  }

  async stage(files: string[]): Promise<void> {
    await this.git.add(files);
  }

  async unstage(files: string[]): Promise<void> {
    await this.git.reset(["HEAD", "--", ...files]);
  }

  // Revert tracked files back to HEAD. When `staged` is true we also drop the
  // index entries so a staged-and-modified file is fully thrown away in one go.
  async discardChanges(files: string[], opts: { staged: boolean }): Promise<void> {
    if (opts.staged) {
      await this.git.raw(["restore", "--staged", "--worktree", "--", ...files]);
    } else {
      await this.git.raw(["restore", "--worktree", "--", ...files]);
    }
  }

  // Untracked files aren't in git, so `restore` won't touch them — delete on disk.
  async discardUntracked(files: string[]): Promise<void> {
    const path = await import("path");
    const fsp = await import("fs/promises");
    await Promise.all(
      files.map((f) => fsp.rm(path.join(this.repoPath, f), { force: true, recursive: true })),
    );
  }

  // Two `-m` args become subject + blank line + body — the convention git
  // expects. Skipping `body` means a one-line commit.
  async commit(opts: CommitOpts): Promise<{ success: boolean; error?: string }> {
    const args = ["commit"];
    if (opts.noVerify) args.push("--no-verify");
    if (opts.signoff) args.push("--signoff");
    args.push("-m", opts.subject);
    if (opts.body && opts.body.trim()) args.push("-m", opts.body);
    try {
      await this.git.raw(args);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: String(e) };
    }
  }

  // Content-history search ("pickaxe"). Finds commits where the number of
  // occurrences of `query` changed (added or removed). Caller passes limit
  // so we cap result-set size — pickaxe scans the full history.
  async logPickaxe(query: string, limit: number): Promise<CommitNode[]> {
    if (!query.trim()) return [];
    const FS = "\x1f";
    try {
      const raw = await this.git.raw([
        "log",
        "--all",
        `-S${query}`,
        `--max-count=${limit}`,
        `--format=COMMIT_SEP%n%H${FS}%P${FS}%an${FS}%ae${FS}%aI${FS}%D${FS}%s`,
      ]);
      return parseRawLog(raw);
    } catch {
      return [];
    }
  }

  // Amend HEAD. Whatever is staged gets folded in; author override lets users
  // correct a misattributed commit (`git commit --amend --author=…`).
  async amendCommit(opts: CommitOpts & { author?: string }): Promise<{ success: boolean; error?: string }> {
    const args = ["commit", "--amend"];
    if (opts.noVerify) args.push("--no-verify");
    if (opts.signoff) args.push("--signoff");
    if (opts.author) args.push(`--author=${opts.author}`);
    args.push("-m", opts.subject);
    if (opts.body && opts.body.trim()) args.push("-m", opts.body);
    try {
      await this.git.raw(args);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: String(e) };
    }
  }

  // Change HEAD's author without touching its message. Only HEAD can be
  // amended this way — older commits need an interactive rebase.
  async setHeadAuthor(author: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.git.raw(["commit", "--amend", "--no-edit", `--author=${author}`]);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: String(e) };
    }
  }

  // "Name <email>" for the HEAD commit — used to prefill the author-edit modal.
  async getHeadAuthor(): Promise<string> {
    try {
      const raw = await this.git.raw(["log", "-1", "--format=%an <%ae>", "HEAD"]);
      return raw.trim();
    } catch { return ""; }
  }

  // Full commit message (subject + body) for `sha` — defaults to HEAD. `%B`
  // gives the raw message including blank lines; `%s` would only give the
  // subject. Used by amend pre-fill (HEAD) and CommitDetail (any commit).
  async getCommitMessage(sha = "HEAD"): Promise<string> {
    try {
      const raw = await this.git.raw(["log", "-1", "--format=%B", sha]);
      return raw.replace(/\n$/, "");
    } catch {
      return "";
    }
  }

  // Promote a stash to a branch. Equivalent to `git stash branch <name>
  // stash@{<index>}` — creates the branch at the stash's base commit, applies
  // the stash, drops it from the list. Lets users turn ad-hoc WIP into real
  // branches without conflict-prone unstashing into HEAD.
  async stashBranch(name: string, index: number): Promise<{ success: boolean; error?: string }> {
    try {
      await this.git.raw(["stash", "branch", name, `stash@{${index}}`]);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: String(e) };
    }
  }

  async stashSave(message?: string): Promise<void> {
    // `stash push -u` is the modern form and includes untracked files so a
    // quick "stash everything" from the toolbar doesn't leave new files behind.
    const args = ["stash", "push", "--include-untracked"];
    if (message) args.push("-m", message);
    await this.git.raw(args);
  }

  async stashPop(index: number): Promise<void> {
    await this.git.stash(["pop", `stash@{${index}}`]);
  }

  async stashDrop(index: number): Promise<void> {
    await this.git.stash(["drop", `stash@{${index}}`]);
  }

  async stashApply(index: number): Promise<void> {
    await this.git.stash(["apply", `stash@{${index}}`]);
  }

  async fetch(): Promise<void> {
    await this.git.raw([...this.getAuthConfigs(), "fetch", "--all", "--prune"]);
  }

  // Pull with optional recovery hints. The renderer calls this twice when
  // needed: first as a probe, then with whichever recovery the user chose
  // (autostash for dirty trees; rebase|merge for diverged branches).
  //
  // Failure kinds the renderer can react to:
  //   'dirty'      → local modifications block merge → offer autostash retry
  //   'diverged'   → no merge strategy configured for divergent branches
  //   'untracked'  → untracked files would be overwritten → user must clear them
  //   'conflict'   → merge produced conflicts → user resolves manually
  //   'auth'       → credentials missing / rejected
  //   'unknown'    → anything else
  async pull(opts: { rebase?: boolean; autoStash?: boolean } = {}): Promise<{ success: boolean; error?: string; kind?: string }> {
    const args = [...this.getAuthConfigs(), "pull"];
    if (opts.rebase === true) args.push("--rebase");
    else if (opts.rebase === false) args.push("--no-rebase");
    if (opts.autoStash) args.push("--autostash");
    try {
      await this.git.raw(args);
      return { success: true };
    } catch (e: unknown) {
      const msg = String(e);
      const kind = classifyPullError(msg);
      return { success: false, error: msg, kind };
    }
  }

  async push(): Promise<{ success: boolean; error?: string }> {
    try {
      try {
        await this.git.raw([...this.getAuthConfigs(), "push"]);
      } catch (err: any) {
        // If push fails because of no upstream branch, try setting it automatically
        if (err.message && err.message.includes("has no upstream branch")) {
          const status = await this.getStatus();
          const currentBranch = status.branch;
          if (currentBranch) {
            await this.git.raw([
              ...this.getAuthConfigs(),
              "push",
              "-u",
              "origin",
              currentBranch,
            ]);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: String(e) };
    }
  }

  async createBranch(name: string, startPoint?: string): Promise<void> {
    if (startPoint) {
      await this.git.checkoutBranch(name, startPoint);
    } else {
      await this.git.checkoutLocalBranch(name);
    }
  }

  async deleteBranch(name: string, force = false): Promise<void> {
    await this.git.branch([force ? "-D" : "-d", name]);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.git.raw(["branch", "-m", oldName, newName]);
  }

  async deleteRemoteBranch(remote: string, branch: string): Promise<void> {
    await this.git.raw([
      ...this.getAuthConfigs(),
      "push",
      remote,
      "--delete",
      branch,
    ]);
  }

  async revert(sha: string): Promise<void> {
    await this.git.raw(["revert", "--no-edit", sha]);
  }

  /**
   * Single entry point for branch-pill drag-and-drop actions.
   *
   * - 'checkout': just check out target
   * - 'merge':    checkout target, merge source, restore (autostash)
   * - 'rebase':   checkout source, rebase --autostash onto target
   *
   * Errors (including merge conflicts) are returned as structured results, never thrown.
   */
  async runDragAction(
    source: string,
    target: string,
    action: "merge" | "rebase" | "checkout",
  ): Promise<{ success: boolean; error?: string; autoStashed?: boolean }> {
    if (action === "checkout") {
      try {
        await this.git.checkout(target);
        return { success: true };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    }

    if (action === "rebase") {
      try {
        const status = await this.git.status();
        if (status.current !== source) {
          await this.git.checkout(source);
        }
        await this.git.raw(["rebase", "--autostash", target]);
        return { success: true };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    }

    // action === 'merge': merge source INTO target, restore original branch
    let originalBranch: string | null = null;
    let autoStashed = false;
    try {
      const status = await this.git.status();
      originalBranch = status.current;
      if (!originalBranch) throw new Error("Not on a branch (detached HEAD).");

      if (status.files.length > 0) {
        await this.git.stash([
          "push",
          "--include-untracked",
          "-m",
          `git-gud: auto-stash before drag-merge ${source} → ${target}`,
        ]);
        autoStashed = true;
      }

      await this.git.checkout(target);
      await this.git.merge([source]);
      await this.git.checkout(originalBranch);
      return { success: true, autoStashed };
    } catch (e) {
      if (originalBranch) {
        try { await this.git.checkout(originalBranch); } catch { /* best-effort */ }
      }
      return { success: false, error: String(e), autoStashed };
    } finally {
      if (autoStashed) {
        try { await this.git.stash(["pop"]); } catch { /* stash stays if pop conflicts */ }
      }
    }
  }

  async merge(branch: string): Promise<void> {
    await this.git.merge([branch]);
  }

  /**
   * Merges the currently checked-out branch INTO the target branch,
   * then restores the original branch.
   *
   * Auto-stashes any uncommitted changes before switching branches and
   * always restores them when done (even on failure).
   */
  async mergeCurrentInto(
    targetBranch: string,
  ): Promise<{ success: boolean; error?: string; autoStashed?: boolean }> {
    let currentBranch: string | null = null;
    let autoStashed = false;
    try {
      const status = await this.git.status();
      currentBranch = status.current;
      if (!currentBranch) throw new Error("Not on a branch (detached HEAD).");

      // Auto-stash dirty working tree so checkout won't abort
      if (status.files.length > 0) {
        await this.git.stash([
          "push",
          "--include-untracked",
          "-m",
          `git-gud: auto-stash before merge into ${targetBranch}`,
        ]);
        autoStashed = true;
      }

      await this.git.checkout(targetBranch);
      await this.git.merge([currentBranch]);
      await this.git.checkout(currentBranch);
      return { success: true, autoStashed };
    } catch (e: unknown) {
      // Always try to restore original branch on failure
      if (currentBranch) {
        try { await this.git.checkout(currentBranch); } catch { /* best-effort */ }
      }
      return { success: false, error: String(e), autoStashed };
    } finally {
      // Always pop the auto-stash so changes aren't lost
      if (autoStashed) {
        try { await this.git.stash(["pop"]); } catch { /* stash stays if pop conflicts */ }
      }
    }
  }

  async cherryPick(sha: string): Promise<void> {
    await this.git.raw(["cherry-pick", sha]);
  }

  async reset(sha: string, mode: "soft" | "mixed" | "hard"): Promise<void> {
    await this.git.raw(["reset", `--${mode}`, sha]);
  }

  async rebaseTo(sha: string): Promise<{ success: boolean; error?: string }> {
    try {
      // --autostash stashes dirty changes, rebases, then restores — built-in git behaviour
      await this.git.raw(["rebase", "--autostash", sha]);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: String(e) };
    }
  }

  async createTag(name: string, sha: string): Promise<void> {
    await this.git.raw(["tag", name, sha]);
  }

  async getWorktrees(): Promise<WorktreeInfo[]> {
    const raw = await this.git.raw(["worktree", "list", "--porcelain"]);
    const trees: WorktreeInfo[] = [];
    const blocks = raw.trim().split(/\n\n/);
    for (const block of blocks) {
      const lines = block.trim().split("\n");
      const worktree: Partial<WorktreeInfo> = {};
      for (const line of lines) {
        if (line.startsWith("worktree ")) worktree.path = line.slice(9);
        if (line.startsWith("HEAD ")) worktree.sha = line.slice(5);
        if (line.startsWith("branch "))
          worktree.branch = line.slice(7).replace("refs/heads/", "");
        if (line === "bare") worktree.branch = "(bare)";
      }
      if (worktree.path) {
        trees.push({
          path: worktree.path,
          branch: worktree.branch || "detached HEAD",
          sha: worktree.sha || "",
          isMain: trees.length === 0,
        });
      }
    }
    return trees;
  }

  async addWorktree(path: string, branch: string): Promise<void> {
    await this.git.raw(["worktree", "add", path, branch]);
  }

  async removeWorktree(path: string): Promise<void> {
    await this.git.raw(["worktree", "remove", path]);
  }

  async bisectStart(): Promise<void> {
    await this.git.raw(["bisect", "start"]);
  }

  async bisectGood(sha?: string): Promise<string> {
    const args = ["bisect", "good"];
    if (sha) args.push(sha);
    return this.git.raw(args);
  }

  async bisectBad(sha?: string): Promise<string> {
    const args = ["bisect", "bad"];
    if (sha) args.push(sha);
    return this.git.raw(args);
  }

  async bisectReset(): Promise<void> {
    await this.git.raw(["bisect", "reset"]);
  }

  async formatPatch(sha: string): Promise<string> {
    return this.git.raw(["format-patch", "-1", "--stdout", sha]);
  }

  async applyPatch(
    patchContent: string,
    opts: { reverse?: boolean; cached?: boolean } = {},
  ): Promise<void> {
    // Write to temp file and apply
    const { writeFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const tmpFile = join(tmpdir(), `git-patch-${Date.now()}.patch`);
    writeFileSync(tmpFile, patchContent);
    try {
      const args = ["apply", "--recount"];
      if (opts.cached) args.push("--cached");
      if (opts.reverse) args.push("--reverse");
      args.push(tmpFile);
      await this.git.raw(args);
    } catch (err) {
      console.error("applyPatch failed:", err, "Patch was:", patchContent);
      throw err;
    } finally {
      unlinkSync(tmpFile);
    }
  }

  async getReflog(limit = 100): Promise<CommitNode[]> {
    const FS = "\x1f";
    const raw = await this.git.raw([
      "reflog",
      `--format=COMMIT_SEP%n%H${FS}%P${FS}%an${FS}%ae${FS}%aI${FS}%gD${FS}%gs`,
      `-n${limit}`,
    ]);
    return parseRawLog(raw);
  }
}

// ── Pull error classifier ─────────────────────────────────────────────────────
// Maps git's stderr output to a coarse "kind" so the renderer can offer
// targeted recovery. Patterns are conservative — anything we can't classify
// falls back to 'unknown' and the user sees the raw error.
function classifyPullError(msg: string): string {
  if (/your local changes to the following files would be overwritten/i.test(msg)) return "dirty";
  if (/please commit your changes or stash them before you (merge|rebase|pull)/i.test(msg)) return "dirty";
  if (/cannot pull with rebase: you have unstaged changes/i.test(msg)) return "dirty";
  if (/divergent branches|need to specify how to reconcile/i.test(msg)) return "diverged";
  if (/the following untracked working tree files would be overwritten/i.test(msg)) return "untracked";
  if (/conflict.*merge|automatic merge failed|fix conflicts and then commit/i.test(msg)) return "conflict";
  if (/could not read username|authentication failed|terminal prompts disabled/i.test(msg)) return "auth";
  return "unknown";
}

// ── Raw log parser ────────────────────────────────────────────────────────────
function parseRawLog(raw: string): CommitNode[] {
  const FS = "\x1f";
  const commits: CommitNode[] = [];
  const blocks = raw.split("COMMIT_SEP\n").filter((b) => b.trim());

  for (const block of blocks) {
    // Fields: sha \x1f parents \x1f author \x1f email \x1f date \x1f refs \x1f message
    const parts = block.trimEnd().split(FS);
    const sha = parts[0]?.trim() || "";
    if (!sha || sha.length < 7) continue;

    const parentLine = parts[1]?.trim() || "";
    const parents = parentLine ? parentLine.split(" ").filter(Boolean) : [];
    const author   = parts[2]?.trim() || "";
    const email    = parts[3]?.trim() || "";
    const date     = parts[4]?.trim() || "";
    const refsRaw  = parts[5]?.trim() || "";
    const message  = parts.slice(6).join(FS).trim();

    // Stash internals: parent2/parent3 of a stash commit ("index on …",
    // "untracked files on …") get walked by --topo-order and show up as
    // ghost nodes. The stash top itself stays — graph renders it as a
    // dotted stash node and the sidebar links into it.
    if (
      /^index on /.test(message) ||
      /^untracked files on /.test(message)
    ) {
      continue;
    }

    // Parse refs: e.g. "HEAD -> main, origin/main, tag: v1.0"
    const refs: string[] = [];
    if (refsRaw) {
      for (const part of refsRaw.split(",")) {
        const t = part.trim();
        if (!t) continue;
        if (t.startsWith("HEAD -> ")) {
          refs.push("HEAD");
          refs.push(t.replace("HEAD -> ", ""));
        } else if (t.startsWith("tag: ")) {
          refs.push(t);
        } else {
          refs.push(t);
        }
      }
    }

    commits.push({
      sha,
      shortSha: sha.slice(0, 7),
      message,
      author,
      email,
      date,
      timestamp: date ? new Date(date).getTime() : 0,
      parents,
      refs: refs.filter(Boolean),
    });
  }

  return commits;
}
