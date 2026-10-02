# companion-pr-review Specification (delta)

## ADDED Requirements

### Requirement: Pull request entry point
The Machines screen SHALL show a "Pull requests" card when any paired machine reports the `forge` feature. Tapping it SHALL open the inbox for that machine.

#### Scenario: Host without forge
- **WHEN** no paired machine reports `forge`
- **THEN** no Pull requests card is shown

### Requirement: Inbox toggle
The inbox SHALL offer a two-way toggle, **All open** ⇄ **Needs review**, with a count on each side. It SHALL remember the last choice on the phone. Rows SHALL show the repo, number, title, author, age, draft state, belt rollup, bot verdict, size and the local viewed progress.

#### Scenario: Switching to Needs review
- **WHEN** the user switches the toggle to Needs review
- **THEN** only rows with `needsReview` are listed, with no extra host round-trip

### Requirement: PR screen
The PR screen SHALL pin the bot verdict (headline plus review focus, expandable to the full comment) and the status contexts above the Overview, Files and Commits tabs. A "Start reviewing" action SHALL open the file pager at the first unviewed file.

### Requirement: File pager
The file pager SHALL show one file per page and move between files with a horizontal swipe. Diff lines SHALL wrap instead of scrolling sideways, and SHALL be virtualised. Lockfiles, binaries and patches over 1,500 lines SHALL be collapsed until tapped. A primary "Viewed & next" action SHALL mark the file viewed and advance. When the host answers `stale`, the pager SHALL show a reload bar instead of mixing two heads.

### Requirement: Viewed state survives unchanged files
The phone SHALL store viewed state locally as `patchHash` per file. After a new push, files whose `patchHash` changed SHALL become unviewed, and the rest SHALL stay viewed.

#### Scenario: Fix-up push
- **WHEN** 9 files were viewed and a push changes 1 of them
- **THEN** the PR shows 8/9 viewed and "Start reviewing" opens the changed file
