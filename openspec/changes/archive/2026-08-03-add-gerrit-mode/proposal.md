# Proposal: add-gerrit-mode

## Why

Gerrit workflows are fundamentally different from GitHub-style branch workflows: nobody pushes feature branches, review happens by pushing `HEAD:refs/for/<branch>`, iterations are amends (new patchsets) rather than new commits, and in-flight work lives in hidden `refs/changes/*` refs invisible to a normal branch view. Today git-gud has no notion of this — `push()` cannot express a refspec, amending warns about force-pushes that never happen in Gerrit, and there is no way to see which changes are open for review. Users working against Gerrit remotes get a misleading, branch-centric picture of their repo.

## What Changes

- **Gerrit detection**: recognize repos whose remote points at a Gerrit server using layered heuristics (remote URL patterns such as SSH port 29418 or `gerrit` in the host/path, a `.gitreview` file, a `commit-msg` hook that inserts Change-Id, Change-Id trailers in recent history). Detection only *suggests*; the user opts in per repo. The flag persists in repo-local git config (`gitgud.gerrit.enabled`, `gitgud.gerrit.host`, `gitgud.gerrit.branch`).
- **Push for review**: a new refspec-capable push path (`git push <remote> HEAD:refs/for/<branch>`) with support for topic (`%topic=`), WIP (`%wip`), ready (`%ready`), and private options. Surfaced in the Toolbar push caret menu and as a primary action when Gerrit mode is active. The existing bare `push()` is untouched.
- **Open changes view**: a Gerrit panel listing open changes for the repo's project via the Gerrit REST API (`/changes/?q=status:open`), anonymous by default with optional HTTP-password auth stored encrypted via `safeStorage`. Each change shows subject, number, owner, patchset count, WIP state, and links the local commit when its Change-Id matches.
- **Change-Id awareness**: commit detail parses trailers out of the message body and renders `Change-Id` (and other trailers) as structured metadata instead of raw body text; in Gerrit mode the Change-Id links to the change on the Gerrit host.
- **Amend-friendly UX**: when Gerrit mode is active, the working-tree amend checkbox drops its force-push warning (amend + re-push-for-review is the normal Gerrit iteration) and instead hints that a new patchset will be created.
- **Zero impact outside Gerrit mode**: all behavior above is additive and gated on the per-repo flag; repos without Gerrit remotes see no UI or behavioral difference.

## Capabilities

### New Capabilities

- `gerrit-detection`: heuristics that identify a Gerrit remote, the suggestion flow, and the per-repo opt-in/opt-out mode flag persisted in git config.
- `gerrit-review-push`: pushing the current HEAD for review to `refs/for/<branch>` with topic/WIP/ready/private options, including error surfacing for Gerrit's rejection messages (missing Change-Id, no new changes).
- `gerrit-changes`: fetching and rendering the open-changes list from the Gerrit REST API, optional authenticated access, correlation of remote changes with local commits by Change-Id, and structured trailer display in commit detail.

### Modified Capabilities

- `commit-amend`: the amend flow's force-push warning becomes mode-aware — suppressed and replaced with patchset messaging when Gerrit mode is active (requirement change: warning text/conditions depend on repo mode).

## Impact

- **Main process**: new `src/main/gerrit-service.ts` (REST client on native `fetch`, `)]}'` prefix stripping, detection helpers); `GitService` gains a refspec push method and a trailer-aware log field; new `gerrit:*` IPC handlers in `src/main/index.ts`; `classifyGitArgs` learns the new write command.
- **Preload**: new `gerritApi` namespace + types (`GerritChange`, `GerritDetection`, push-for-review options); no changes to existing `gitApi` signatures.
- **Renderer**: new `useGerrit` hook (detection state, changes list, actions); Gerrit panel component; Toolbar caret-menu entry; `CommitDetail` trailer parsing; `WorkingTree` amend-warning gate. All rendered conditionally on mode.
- **Security**: Gerrit HTTP password stored only via `safeStorage` in `userData` (same pattern as `provider-auth.json`); credentials never written to repo or logs (existing `redactAuthArgs`/`scrubSecrets` cover the git side).
- **Dependencies**: none added — native `fetch`, existing `simple-git`.
- **Grade**: production-grade intent, same bar as existing push/pull flows; the REST layer starts read-only (list open changes) — review actions (vote, submit) are explicitly out of scope for this change.
