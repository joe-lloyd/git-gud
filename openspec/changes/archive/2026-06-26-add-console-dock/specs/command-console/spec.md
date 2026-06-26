## ADDED Requirements

### Requirement: Run commands at the worktree root

The left console SHALL accept a typed shell command and run it non-interactively at the current worktree root, streaming stdout and stderr to the console output and reporting the exit code on completion. The working directory SHALL track the active repository/worktree.

#### Scenario: Run a command

- **WHEN** the user types a command and submits it
- **THEN** the command runs with its working directory set to the active worktree root, and its output streams into the console followed by the exit code

#### Scenario: Working directory follows the worktree

- **WHEN** the user switches to a different worktree/repo and runs a command
- **THEN** the command executes at the newly-active worktree root

#### Scenario: Failure shows non-zero exit

- **WHEN** a command exits non-zero
- **THEN** the console shows the error output and the non-zero exit code

### Requirement: Command history and prompt

The console SHALL show the current working directory as a prompt and SHALL let the user recall previously-entered commands (e.g. via Up/Down) within the session.

#### Scenario: Recall a previous command

- **WHEN** the user presses Up in the command input
- **THEN** the previous command is recalled into the input

### Requirement: Interrupt a running command

The user SHALL be able to cancel/terminate a command that is still running.

#### Scenario: Cancel a long command

- **WHEN** a command is running and the user cancels it
- **THEN** the process is terminated and the console notes that it was interrupted

### Requirement: Non-interactive scope

The console SHALL run non-interactive commands only; programs that require an interactive terminal (full-screen TUIs, prompts reading from a TTY) are out of scope and MAY fail or hang until cancelled.

#### Scenario: Interactive program is not supported

- **WHEN** the user runs a program that requires a TTY (e.g. a full-screen editor)
- **THEN** it is not supported — the console does not provide a pseudo-terminal, and the user can cancel it
