# Git feature coverage

The authoritative list of Git functionality supported by this app, what's partial, what's planned, and what isn't.

Status legend:
- ✅ **supported** — fully implemented, accessible from the UI
- 🟡 **partial** — works but rough edges or missing UX polish
- 📅 **planned** — on the roadmap; spec lives in `openspec/changes/`
- 🚫 **not planned** — explicitly out of scope (for now)

---

## History

| Feature | Status | Surface |
| --- | --- | --- |
| `git log` (all branches) | ✅ supported | Commit graph (main view) |
| `git log -S <string>` (pickaxe) | ✅ supported | SearchBar "Content" mode |
| `git reflog` (recovery) | ✅ supported | Advanced bar → Reflog panel (restore / copy SHA) |
| `git show <sha>` (commit diff) | ✅ supported | CommitDetail panel + DiffViewer |
| `git diff` (working tree) | ✅ supported | DiffViewer |
| `git diff --word-diff` | ✅ supported | DiffViewer header "Word diff" toggle |
| `git diff <a>..<b>` (range) | 🟡 partial | Implicit via commit selection; no explicit picker |
| `git blame` | 🚫 not planned | Out of scope for this app |
| `git bisect` | ✅ supported | Right-column Bisect panel |

## Staging

| Feature | Status | Surface |
| --- | --- | --- |
| `git add <files>` | ✅ supported | WorkingTree (stage button, `Space`) |
| `git reset HEAD <files>` (unstage) | ✅ supported | WorkingTree (unstage button, `Space`) |
| `git add -p` (hunk-level) | ✅ supported | DiffViewer Stage chunk button |
| `git add -p` (line-level) | ✅ supported | DiffViewer +/− sign click |
| `git add -p` (keyboard polish) | ✅ supported | DiffViewer: `j/k`, `s`/`⇧S`, `d`/`⇧D`, Alt-click line, `?` overlay |
| Discard hunk | ✅ supported | DiffViewer Discard chunk button (two-step confirm) |
| Discard file | ✅ supported | WorkingTree `d` / `Delete` |
| Discard untracked file | ✅ supported | WorkingTree `d` (deletes file from disk) |
| `git commit` | ✅ supported | WorkingTree commit box |
| `git commit --amend` | ✅ supported | WorkingTree "Amend last commit" toggle |
| `git commit -S` (GPG sign) | 🚫 not planned | Possible follow-up in Settings panel |

## Branching

| Feature | Status | Surface |
| --- | --- | --- |
| `git branch` (list) | ✅ supported | Sidebar Local/Remote sections |
| `git branch <name>` (create) | ✅ supported | Toolbar + commit context menu "Branch here" |
| `git branch -m <new>` (rename) | ✅ supported | Branch context menu |
| `git branch -d` / `-D` (delete) | ✅ supported | Branch context menu |
| `git checkout <branch>` | ✅ supported | Branch double-click + context menu |
| `git checkout -b <name> <ref>` | ✅ supported | Branch-from-tag, branch-here on commit |
| `git tag` (list) | ✅ supported | Sidebar Tags section |
| `git tag -a <name>` (annotated create) | ✅ supported | Commit context menu "Tag here" |
| `git tag -d` (delete) | ✅ supported | Tag context menu |
| `git stash branch <name>` | ✅ supported | Stash context menu "Create branch from stash…" |
| `git worktree add` | ✅ supported | Worktrees modal + sidebar "+ Manage" |
| `git worktree list` | ✅ supported | Sidebar Worktrees section |
| `git worktree remove` | ✅ supported | Worktree context menu |

## Remote

| Feature | Status | Surface |
| --- | --- | --- |
| `git fetch` | ✅ supported | Toolbar Fetch button |
| `git pull` | ✅ supported | Toolbar Pull button |
| `git push` | ✅ supported | Toolbar Push button |
| `git push --force-with-lease` | 🟡 partial | Available via amend workflow (not exposed yet) |
| `git remote add` | ✅ supported | GitHub panel (auto-adds origin) |
| `git remote -v` (list) | ✅ supported | Sidebar Remote section |
| GitHub OAuth + repo create | ✅ supported | GitHub panel |
| `git clone` | 🚫 not planned | Use the OS file dialog to open existing repos |

## Recovery

| Feature | Status | Surface |
| --- | --- | --- |
| `git stash save` / `pop` / `apply` / `drop` | ✅ supported | Sidebar Stashes section |
| `git reset --hard <sha>` | ✅ supported | Commit context menu (two-step confirm) |
| `git reset --soft` / `--mixed` | 🟡 partial | Available via interactive rebase; not as direct action |
| `git reflog` browse + restore | ✅ supported | Advanced bar → Reflog panel (restore HEAD / copy SHA) |
| `git restore <files>` (discard) | ✅ supported | WorkingTree discard (`d` / `Delete`) |
| `git clean -fdx` | ✅ supported | Advanced bar → Clean modal (scope toggles + type-to-confirm) |

## Advanced

| Feature | Status | Surface |
| --- | --- | --- |
| `git merge <branch>` | ✅ supported | Ref-pill drag-drop + context menu |
| `git rebase <onto>` | ✅ supported | Commit context menu "Rebase onto this commit" |
| `git rebase -i` (interactive) | ✅ supported | Commit context menu "Interactive rebase from here" |
| `git cherry-pick <sha>` | ✅ supported | Commit context menu |
| `git format-patch` / `git am` / `git apply` | ✅ supported | Advanced bar Patch panel |
| `git rerere` (reuse resolutions) | ✅ supported | Settings toggle + auto-resolution banner (Forget) in conflict panel |

## Not planned (yet)

These features are explicitly out of scope at the moment. They may become roadmap items in the future based on demand.

- **Git LFS** — large-file storage tracking and pull/push integration
- **Submodules** — `git submodule add/update/init` + nested-repo UI
- **Sparse checkout** — `git sparse-checkout` for monorepo subsetting
- **Partial clone** / **shallow clone** — bandwidth-saving clone modes
- **Notes** — `git notes` annotations on commits
- **Hooks UI** — installing / managing `.git/hooks/` scripts
- **`git fsck`** / **`git gc`** — maintenance commands

---

*Keep this file in sync with feature work. Each PR that ships a new capability should update its row to ✅.*
