
## Bug Report: Commit Graph Lane Allocation & Edge Routing Failure

**Issue 1: Incorrect Branch Divergence (False Edges)**

* **Actual Behavior (`BUG_IMG/image1.png`):** Sibling commits sharing the same parent ("seed data updated") fail to diverge into separate lanes. The rendering algorithm incorrectly draws edges that suggest false parent-child relationships between parallel branches, failing to visually separate divergent worktrees.
* **Expected Behavior (`BUG_IMG/image1.png`):** When multiple child commits reference the same parent OID, the graph must branch. Each divergent path requires a distinct, non-overlapping lane (column) to accurately reflect the topology.

**Issue 2: Suboptimal Lane Compaction**

* **Actual Behavior:** A continuous linear history remains stranded in an outer lane (e.g., column 3) even when the inner lanes (columns 1 and 2) are completely unoccupied.
* **Expected Behavior:** Active branches should shift leftward (towards index 0) to fill empty columns once parallel branches terminate or merge.

### Root Cause

The graphing utility lacks a robust topological sorting and lane assignment phase. Commits are likely being processed sequentially without properly tracking active parallel trajectories and their parent dependency chains, causing the renderer to reuse lanes prematurely or draw edges directly to adjacent DOM elements rather than logical parents.

### Implementation Strategy

Implement a sweep-line lane assignment algorithm over a topologically sorted commit list (processed newest to oldest).

1. **Topological Sort:** Sort the commit array by topology and timestamp before generating graph nodes.
2. **State Management:** Maintain an `activeLanes` array representing the columns currently occupied by branch trajectories.
3. **Node Processing (Top-Down):**
* **Match:** If the current commit is the parent of a commit in an active lane, place it in that lane.
* **Merge Commits:** If the commit has multiple parents (merge), keep the primary parent in the current lane and allocate the first available empty lane in `activeLanes` for the secondary parent.
* **Branch Divergence (Resolves Issue 1):** If the current commit is the parent of *multiple* active lanes (i.e., multiple branches started from this commit), converge those paths. Keep the leftmost lane active for the ancestor, terminate the other redundant lanes, and draw edges from the terminated lanes to this ancestor node.
* **New Branch:** If a commit is encountered that isn't expected by any active lane, assign it to the lowest available index in `activeLanes`.


4. **Lane Compaction (Resolves Issue 2):** After resolving edges for a row, run a compaction check. If an inner index in `activeLanes` becomes `null` or empty, shift outer active lanes leftward, provided the shift doesn't cross unresolved edges.

---

## Feature Spec: Handle Stale `index.lock`

| Field | Details |
| --- | --- |
| **Component** | git-gud Staging / Git Operations |
| **Issue** | `git add` fails when a stale `.git/index.lock` file exists from a previous crashed process. |
| **Trigger** | Attempting to stage files while `.git/index.lock` is present in the repository root. |
| **Error Output** | `fatal: Unable to create '[path]/.git/index.lock': File exists.` |

### Current Behavior

The application receives the fatal error from the Git CLI and staging fails without providing the user a way to resolve it within the GUI.

### Proposed Resolution

Intercept the specific Git lock error and surface a resolution prompt to the user.

1. **Error Interception:** Parse the `stderr` output of Git commands. Match against the regex: `/Unable to create '.*\.git[\\/]index\.lock': File exists/`.
2. **UI Prompt:** Render a dialog overlay to the user: *"Git index is locked. A previous Git process may have crashed. Remove the lock file to continue?"* (Buttons: **Cancel**, **Remove Lock & Retry**).
3. **File Operation:** If the user confirms, use Node's `fs.promises.unlink` to delete the `.git/index.lock` file at the specified repository path.
4. **Retry:** Automatically re-execute the original `git add` command.

### Implementation Notes

* **Safety:** Ensure the `fs.promises.unlink` call is wrapped in a try/catch block to handle `EPERM` (file genuinely locked by an active, running process) or `ENOENT` (file already removed).
* **Pathing:** Use `path.join(repoRoot, '.git', 'index.lock')` to ensure cross-platform compatibility between Windows and POSIX systems.