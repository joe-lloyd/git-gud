# Git Gud feature list

Everything Git Gud does, grouped by area, with the episode of the video
series that shows it. Built from the source on 2026-10-24 (v1.21.1). The
[user guide](user-guide.md) explains how to use each feature, and
[git-features.md](git-features.md) lists git coverage. Labels in quotes are
the exact text on screen.

## The family

| App | What it does | Episode |
| --- | --- | --- |
| Git Gud desktop | The Electron client for macOS, Windows and Linux. | 1 to 11 |
| gitgud-headless | A single-file Node daemon that serves repositories from a machine with no screen. | 12 |
| gitgud-relay | A rendezvous service you host, so devices reach each other from anywhere. It forwards only ciphertext. | 12 |
| Companion app | A read-only Android and iOS client, paired by QR code. | 13 |

All four speak one protocol (`packages/peer-protocol`): HTTPS JSON-RPC and
server-sent events on port 47831, with certificates pinned at pairing.

## Start page and tabs (episode 1)

- "Open Repository" opens any folder with a git repository. Cmd+O does the same.
- "Clone from Remote…" clones by URL, or lists your repositories on GitHub, GitLab or Bitbucket once you are signed in.
- "Connect to a Peer…" opens the peers dialog.
- Recent repositories are listed for one-click reopening.
- Each repository opens in its own tab. The home button returns to the start page.
- Open tabs come back on the next launch.
- The tab bar shows the running version, and the update button when one is ready.

## The main window (episode 1)

- Commit graph in the middle, sidebar on the left, detail panel on the right, console dock at the bottom.
- Sidebar sections: local branches, remote branches (grouped by remote), stashes, worktrees, tags. Each section resizes, and widths persist.
- Under the sidebar: Bisect, Patch, Reflog, Clean.
- Toolbar: Fetch, Pull (with options), Push (with options), Stash, Pop, Branch, and the current-branch pill. Icon buttons: graph labels, GitHub, search, console, check for updates, settings, refresh.
- Cmd+R re-reads the repository from disk. The window also re-syncs on focus and on file changes.

## Commit graph (episode 2)

- Every branch draws in its own lane color. Merges show where lanes join.
- The dashed node at the top is uncommitted work, with a count of changed files.
- Stashes draw as diamonds where they were made.
- Ref pills in the left column: current branch (filled), local, remote, both, tags, worktrees. Extra refs fold into a "+N" chip.
- The tag button chooses which labels show: local branches, remote branches, tags, Gerrit changes, and other ref namespaces.
- Large histories render only the visible rows, and lay out in a worker.
- Click a commit to see its message, author, date, trailers, refs and changed files.
- Click a changed file to open its diff in the middle of the window. Escape closes it.
- Arrow keys, Home and End move through the history.
- Shift-click selects a range. Cmd-click adds or removes single commits.
- With several commits selected, the panel shows the count, authors, whether they are adjacent, and a combined line count.
- Click a SHA anywhere to copy it.

## Search (episode 2)

- Cmd+F opens search. Message mode matches messages, authors and SHAs as you type, and dims the rest of the graph.
- Enter or Down steps to older matches. Up steps to newer ones.
- Content mode runs `git log -S` and finds commits whose diff added or removed the text. Results are capped at 200.
- Inside a diff or a conflict file, Cmd+F finds text in that file.

## Staging and committing (episode 3)

- The changes list shows modified, new and deleted files. Each row has stage and discard buttons. "Stage all", "Unstage all" and "Discard all" act on everything.
- Arrow keys move through the list and open each diff. Cmd-click and Shift-click select several files.
- Discarding asks first. A stale `index.lock` gets its own prompt to remove it.
- The diff viewer has inline and side-by-side views, word diff, and an ignore-whitespace toggle.
- "Stage chunk" stages one hunk. Clicking a line's + or − stages only that line. Alt-click discards one line.
- "Discard chunk" needs a second click within three seconds.
- Hunk keys, with focus in the diff: J and K move, S stages, Shift+S stages all, D discards, Shift+D discards all, ? shows the list.
- Syntax highlighting for common languages in diffs and conflict files.
- Commit box: subject with a 50-character guide, optional description, "Amend last commit", "Skip hooks" (`--no-verify`) and "Sign-off".
- Amending a pushed commit warns you first, except in Gerrit mode.
- Cmd+Enter commits.

## Branches, tags, stashes and worktrees (episode 4)

- Double-click a branch to check it out.
- "Branch" in the toolbar creates a branch where you are.
- Branch menu: checkout, create branch here, rename, merge into the current branch, rebase onto, cherry-pick the tip, reset, create tag, push, force push with lease, pull or fast-forward, delete, copy name.
- Remote branch menu: check out as a tracking branch, merge, rebase, reset, tag, delete on the remote, copy name.
- Drag a branch pill onto another: merge, rebase, or check out the target.
- Annotated tags from any commit. Tag menu: create a branch from it, rename, push, delete locally or on the remote, copy name.
- "Stash" saves everything, including new files, with a message. "Pop" restores the newest stash.
- Stash menu: apply, pop, drop, create a branch from it.
- Worktrees: the manager adds one on a new branch, with a suggested folder next to the project. Switch from the sidebar. A chip in the toolbar shows which checkout is active. Removing a dirty worktree asks first.

## Remotes and hosts (episode 5)

- Fetch fetches all remotes. The Pull and Push buttons count commits behind and ahead.
- Pull options: normal, fast-forward only, rebase.
- Push options: push, force push with lease. Right-click Push or Pull for the same menus.
- When local and remote have diverged, Git Gud asks whether to merge or rebase.
- A rejected push offers "Pull now".
- Integrations: GitHub sign-in by device code, GitLab by token (self-hosted too), Bitbucket by app password.
- Once signed in, git commands to that host authenticate automatically. Tokens are encrypted on the machine.
- Create a repository on the host for the project you have open, added as origin.

## Rewriting history (episode 6)

- Commit menu: checkout (detached), create branch here, cherry-pick, revert, rebase onto this commit, interactive rebase from here, merge into the current branch, reset (soft, mixed, hard), create tag here, export patch, edit author.
- Hard reset asks first.
- Interactive rebase: drag to reorder, click the action to cycle pick, reword, squash, fixup and drop, double-click a message to reword it.
- Multi-select actions: squash, cherry-pick, revert, drop, copy SHAs. Squash and drop need adjacent commits.

## Conflicts and auto-fix (episode 7)

- When a merge, rebase, cherry-pick, revert or stash stops on conflicts, a banner names the paused operation and the right panel lists the files.
- Continue, skip (where git allows) and abort.
- The conflict editor shows current, incoming and the result. Shared lines are lightly tinted, differing lines strongly, and changed words marked.
- Per block: use this side, use both, previous and next block. Or take all current or all incoming.
- Click any line in a side pane to insert it at the cursor in the result.
- The result is an editable, highlighted file. Gutter tags show where each line came from, and a legend counts them.
- "Save & Mark Resolved" writes and stages the file, and warns if conflict markers remain.
- "Reuse recorded conflict resolutions" turns on rerere, with a banner and a Forget action.
- Auto-fix: when a pull, checkout, merge, cherry-pick or revert is refused because of local changes, Git Gud stashes them, retries, puts them back, and lists the steps. A checkout keeps the stash and offers "Pop stash now". A conflicting re-apply keeps the stash and opens the conflict panel. You can turn it off in Settings.

## Recovery and tools (episode 8)

- Reflog: every place HEAD has been. "Restore HEAD here" asks first. Enter restores, C copies the SHA.
- Bisect: pick a good commit (and a bad one, or leave it for HEAD), then mark each commit git checks out as good or bad until the first bad commit is named.
- Patch: export uncommitted changes or a commit as a patch, save or copy it, or paste a patch and apply it.
- Clean: lists untracked and ignored files with checkboxes, and needs the word "delete" typed before it runs.
- Console: runs any command at the repository root, with history on Up and Down, and Stop.
- Git activity: every git command the app runs, with output, exit status and time. "Changes only" hides the read-only queries. Copy grabs the log.

## Gerrit mode (episode 9)

- Detects Gerrit from `.gitreview`, a Change-Id commit-msg hook, a Gerrit-looking host or port 29418, and offers the mode in a banner.
- The enable dialog takes host, project and target branch, stored in the repository's git config.
- Open changes on the server appear in the graph as nodes with a dashed `#number` pill.
- Selecting a change lists every patch set, with a link to the change in the browser. Outdated bases get an "outdated" pill.
- "Latest" or "All" patch sets in the graph.
- "Push for review" becomes the main push: target branch, topic, WIP, private. Gerrit's rejections get messages that say how to fix them.
- Amending shows a "new patchset" hint instead of the force-push warning.
- Create branches and tags on Gerrit through REST when a direct push is denied.
- Gerrit credentials are stored encrypted, or git's cookie file is used.

## Settings and updates (episode 10)

- Text size from 70% to 180%.
- High contrast.
- Auto-fix blocked actions, and reuse recorded conflict resolutions.
- Per-repository Gerrit settings and login.
- Update channel: Stable or Dev (pre-release). Updates download in the background, show progress in the tab bar, and offer a restart.
- Sharing with other Git Gud instances (episode 11).

## Peer connections (episode 11)

- Turn on sharing to make a machine a host. It shows its name, port, a six-digit pairing code, a new-code button and a QR code.
- Other Git Guds on the network appear under Nearby (UDP broadcast on 47832). Connect by address takes an IP, a Tailscale name, or a pasted pairing link.
- Pairing never sends the code. The client sends an HMAC of the code and the host's certificate fingerprint, then pins that certificate.
- A changed certificate stops the connection with a warning. Five wrong codes lock pairing for a while.
- Paired repositories open as tabs. The host runs every git command and streams its working tree live.
- The host can make each device read-only, grant single write scopes, revoke a device, or make every device read-only.
- Tokens expire and rotate. Each paired machine shows its transport and round-trip time.

## gitgud-headless and gitgud-relay (episode 12)

- Install script with a systemd user unit.
- `init` writes a config. It listens only on this machine and is read-only by default.
- `serve`, `pair [--qr]` (a ten-minute pairing window), `status`, `devices`, `allow <id> fetch,pull,push`, `revoke`, `reload`, `stop`, `audit`, `tls show` and `tls rotate`, `forge check`, `update`.
- An audit log of pairings, refusals and every git write.
- Forge support: list and review Forgejo pull requests through the daemon.
- gitgud-relay joins a phone or laptop to a host that keeps an outbound connection open. It routes by the server id in the TLS handshake and never decrypts. A one-command Azure deploy script is included.

## Companion app (episode 13)

- Pair by scanning the host's QR code or pasting the link. The certificate is pinned before the first request.
- Machines: each paired computer and whether it is reachable now.
- Repository: graph, working tree and activity tabs, live over server-sent events.
- Commit and diff views.
- Pull requests: list, review file by file, mark files viewed, open in Forgejo.
- Read-only by design. The host marks phones read-only, and the app refuses writes before they leave the phone. Scoped fetch, pull (fast-forward only) and push (never forced) when the host allows them.
- Optional notifications when a repository changes, with "Fetch now" when that scope is granted.
- Updates by downloading the APK from GitHub Releases.

## Gaps found while filming

- Space and D no longer stage or discard in the changes list, though `git-features.md` still lists them.
- With a clean working tree and a commit selected, there is no way back to the commit box short of selecting the uncommitted row, which only exists when something changed.
- `docs/headless.md` describes the relay's peer id as 16 bytes. The relay accepts 8 to 64 hex characters.
