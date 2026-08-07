---
layout: home

hero:
  name: 'Git Gud'
  text: 'A Git client with a graph worth reading'
  tagline: Every branch as a colored lane. Line-level staging, interactive rebase, conflict tooling, and a log of every git command it runs. Built with Electron + React.
  image:
    src: /icon.svg
    alt: Git Gud
  actions:
    - theme: brand
      text: Install it
      link: /install/
    - theme: alt
      text: User guide
      link: /guide/user-guide
    - theme: alt
      text: GitHub
      link: https://github.com/joe-lloyd/git-gud

features:
  - title: Commit graph that scales
    details: Colored lanes per branch with ref pills, tag markers, stash diamonds, and a live "uncommitted changes" node. Virtualized rows plus canvas lanes keep huge histories responsive.
    link: /guide/user-guide#reading-the-commit-graph
    linkText: How to read it
  - title: Stage a file, a hunk, or one line
    details: Word diff and side-by-side views, per-hunk stage and discard, amend / skip-hooks / sign-off toggles on the commit box.
    link: /guide/user-guide#staging-and-committing
    linkText: Staging workflow
  - title: History surgery without the manpage
    details: Interactive rebase, squash or drop a selected range, cherry-pick, revert, reset — all from the commit context menu. Drag a branch onto another to merge or rebase.
    link: /guide/user-guide#rewriting-history
    linkText: Rewriting history
  - title: Conflicts, guided
    details: Per-hunk ours / theirs / both in a real editor, plus optional rerere so git auto-applies resolutions it has seen before.
    link: /guide/user-guide#merge-conflicts
    linkText: Conflict editor
  - title: Recovery built in
    details: Reflog browser with restore, bisect wizard, patch import/export, and clean with a type-to-confirm guard.
    link: /guide/user-guide#recovery-and-maintenance
    linkText: Recovery tools
  - title: Nothing hidden
    details: The Git Activity log shows every git command the app runs, with output and exit status. A real shell prompt covers whatever the UI doesn't.
    link: /guide/user-guide#the-console-dock
    linkText: Console dock
---

## What it looks like

![Commit graph](/screenshots/graph.png)

<div class="screenshot-pair">

![Staging and committing](/screenshots/staging.png)

![Diff viewer with hunk staging](/screenshots/diff.png)

</div>

## Before you download

Git Gud ships **unsigned** — there's no Apple Developer ID or Windows code-signing
certificate behind it. It's the same app either way, but your OS will push back on
first launch: macOS says *"damaged and can't be opened"*, Windows shows a SmartScreen
warning. Both take about ten seconds to clear, once, per machine.

The [install guide](/install/) walks through it per platform, with the exact commands.

## Host integrations

Sign in to **GitHub** (device flow, no setup), **GitLab** (personal access token,
self-hosted supported), or **Bitbucket** (app password) and push/pull/fetch against
that host authenticate automatically — no credential helper. Tokens are stored
encrypted on-device via Electron `safeStorage`.

There's a **Gerrit mode** too: it auto-detects Gerrit remotes, makes *push for review*
the primary action, and renders open changes as nodes in the graph with their full
amendment history. See the [Gerrit changes spec](/specs/gerrit-changes).

<style>
.screenshot-pair {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
</style>
