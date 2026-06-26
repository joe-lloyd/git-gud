# pickaxe-search Specification

## Purpose
TBD - created by archiving change git-feature-coverage. Update Purpose after archive.
## Requirements
### Requirement: Search mode toggle (Message vs Content)
The SearchBar SHALL expose a mode toggle with two options: "Message" (the existing behavior — substring match on commit messages) and "Content" (new — pickaxe search via `git log -S`). The toggle state SHALL persist for the lifetime of the SearchBar.

#### Scenario: Toggling to Content searches commit contents
- **WHEN** the user opens search, toggles to "Content", and types `oldFunctionName`
- **THEN** the renderer calls a `log:pickaxe` IPC running `git log -S "oldFunctionName" --all --format=...`
- **AND** the result list shows up to 200 commits where the count of that string changed

#### Scenario: Toggling to Message restores message search
- **WHEN** the user toggles back to "Message"
- **THEN** the query re-runs as a message-substring search and updates the list

### Requirement: Pickaxe results are selectable like message results
Each pickaxe result SHALL render with the same row template as message search (short SHA, message subject, author, relative date). Pressing Enter or clicking SHALL select the commit in the graph and close the SearchBar.

#### Scenario: Selecting a pickaxe result navigates to the commit
- **WHEN** the user picks a result with Enter or a click
- **THEN** the commit graph scrolls to that SHA and the row is selected
- **AND** the SearchBar closes

### Requirement: Empty query short-circuits
A blank or whitespace-only query in Content mode SHALL NOT issue an IPC call and SHALL show "Type to search commit contents" placeholder text.

#### Scenario: Empty query shows placeholder
- **WHEN** the user is in Content mode with empty input
- **THEN** the result list shows the placeholder and no IPC is invoked

### Requirement: Truncation indicator at result cap
Pickaxe results SHALL be capped at 200 commits. When the cap is reached, a footer line SHALL show "200 results — refine your query for more."

#### Scenario: 200+ matches surfaces the cap notice
- **WHEN** the pickaxe query matches more than 200 commits
- **THEN** the result list shows the first 200 entries
- **AND** a footer informs the user the result set is truncated

