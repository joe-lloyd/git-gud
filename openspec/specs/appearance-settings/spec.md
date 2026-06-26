# appearance-settings Specification

## Purpose
TBD - created by archiving change establish-baseline-spec. Update Purpose after archive.
## Requirements
### Requirement: Settings surface

The application SHALL provide a Settings dialog, reachable from the toolbar, that exposes appearance controls and can be dismissed with a close action or the Escape key.

#### Scenario: Open settings

- **WHEN** the user activates the settings (gear) control in the toolbar
- **THEN** a Settings dialog opens showing the text-size, contrast, and accent controls

#### Scenario: Dismiss settings

- **WHEN** the Settings dialog is open and the user presses Escape or clicks the backdrop / Done
- **THEN** the dialog closes

### Requirement: Adjustable UI text size

The application SHALL let the user scale the entire interface via native page zoom, between 70% and 180%, and SHALL persist and re-apply the chosen scale on launch.

#### Scenario: Increase text size

- **WHEN** the user increases the text size in Settings
- **THEN** the whole UI scales up uniformly (all text and controls) and the percentage shown updates

#### Scenario: Scale persists

- **WHEN** the user has changed the text size and relaunches the app
- **THEN** the UI opens at the saved zoom level

#### Scenario: Reset

- **WHEN** the user chooses Reset
- **THEN** the scale returns to 100%

### Requirement: High-contrast mode

The application SHALL provide a high-contrast toggle that brightens text and strengthens borders, and SHALL persist the choice.

#### Scenario: Enable high contrast

- **WHEN** the user enables high contrast in Settings
- **THEN** text and border tokens switch to higher-contrast values across the app

#### Scenario: High-contrast persists

- **WHEN** high contrast was enabled and the app relaunches
- **THEN** high contrast is still applied

### Requirement: Neon-pink accent theme

The application SHALL use a hot-neon-pink (Dracula-inspired) accent for primary actions and focus indicators, with sufficient contrast against the dark surfaces.

#### Scenario: Accent on primary actions

- **WHEN** a primary button (e.g. Commit) or a focused input is shown
- **THEN** it uses the neon-pink accent color

