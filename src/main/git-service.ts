import simpleGit, {
  SimpleGit,
  LogResult,
  BranchSummary,
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
    const rawOutput = await this.git.raw([
      "log",
      `--max-count=${limit}`,
      "--all",
      "--parents",
      `--format=COMMIT_SEP%n%H${FS}%P${FS}%an${FS}%ae${FS}%aI${FS}%D${FS}%s`,
    ]);
    return parseRawLog(rawOutput);
  }

  async getBranches(): Promise<BranchData> {
    const summary: BranchSummary = await this.git.branch(["-a", "--verbose"]);
    const local: BranchInfo[] = [];
    const remote: BranchInfo[] = [];

    for (const [name, branch] of Object.entries(summary.branches)) {
      if (name.startsWith("remotes/")) {
        remote.push({
          name: name.replace(/^remotes\//, ""),
          current: false,
          sha: branch.commit,
        });
      } else {
        local.push({
          name,
          current: branch.current,
          sha: branch.commit,
        });
      }
    }

    return { local, remote };
  }

  async getTags(): Promise<TagInfo[]> {
    try {
      const raw = await this.git.raw([
        "tag",
        "-l",
        "--format=%(refname:short) %(objectname:short)",
      ]);
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name, sha] = line.trim().split(" ");
          return { name, sha };
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
    };
  }

  async getCommitDiff(sha: string): Promise<string> {
    return this.git.raw(["show", "--stat", "-p", "--format=", sha]);
  }

  async getFileDiff(filePath: string, staged: boolean): Promise<string> {
    try {
      const args = staged
        ? ["diff", "--cached", "--unified=5", "--", filePath]
        : ["diff", "--unified=5", "--", filePath];
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
    const raw = await this.git.raw([
      "diff-tree",
      "--no-commit-id",
      "-r",
      "--name-status",
      sha,
    ]);
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

  async checkout(
    branch: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.git.checkout(branch);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: String(e) };
    }
  }

  async stage(files: string[]): Promise<void> {
    await this.git.add(files);
  }

  async unstage(files: string[]): Promise<void> {
    await this.git.reset(["HEAD", "--", ...files]);
  }

  async commit(message: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.git.commit(message);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: String(e) };
    }
  }

  async stashSave(message?: string): Promise<void> {
    if (message) {
      await this.git.stash(["save", message]);
    } else {
      await this.git.stash();
    }
  }

  async stashPop(index: number): Promise<void> {
    await this.git.stash(["pop", `stash@{${index}}`]);
  }

  async stashDrop(index: number): Promise<void> {
    await this.git.stash(["drop", `stash@{${index}}`]);
  }

  async fetch(): Promise<void> {
    await this.git.raw([...this.getAuthConfigs(), "fetch", "--all", "--prune"]);
  }

  async pull(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.git.raw([...this.getAuthConfigs(), "pull"]);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: String(e) };
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

  async merge(branch: string): Promise<void> {
    await this.git.merge([branch]);
  }

  /**
   * Merges the currently checked-out branch INTO the target branch,
   * then restores the original branch.
   *
   * Equivalent to:
   *   git checkout <targetBranch>
   *   git merge <currentBranch>
   *   git checkout <currentBranch>
   */
  async mergeCurrentInto(targetBranch: string): Promise<{ success: boolean; error?: string }> {
    let currentBranch: string | null = null;
    try {
      const status = await this.git.status();
      currentBranch = status.current;
      if (!currentBranch) throw new Error("Not on a branch (detached HEAD).");

      await this.git.checkout(targetBranch);
      await this.git.merge([currentBranch]);
      await this.git.checkout(currentBranch);
      return { success: true };
    } catch (e: unknown) {
      // Always try to restore original branch
      if (currentBranch) {
        try { await this.git.checkout(currentBranch); } catch { /* best-effort */ }
      }
      return { success: false, error: String(e) };
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
      await this.git.raw(["rebase", sha]);
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
