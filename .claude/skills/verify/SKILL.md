---
name: verify
description: Build, launch, and drive git-gud (Electron) to verify renderer/main changes end-to-end via CDP + playwright-core screenshots.
---

# Verifying git-gud changes in the running app

## Build & launch with a driveable handle

```powershell
pnpm build   # electron-vite build → out/
pnpm exec electron . --remote-debugging-port=9223 --disable-features=CalculateNativeWinOcclusion --disable-renderer-backgrounding --disable-background-timer-throttling
```

- The occlusion/backgrounding flags are **required**: without them, when the window is
  behind other windows, Windows occlusion detection pauses the renderer and
  Playwright clicks/screenshots hang forever on "waiting for stable".
- Confirm the handle: `http://127.0.0.1:9223/json` should list
  `page … out/renderer/index.html`.

## Drive it

Use `playwright-core` (no browser download) in a scratchpad dir:
`pnpm add playwright-core`, then `chromium.connectOverCDP('http://127.0.0.1:9223')`;
pick the page whose URL isn't `devtools://`.

- The app **restores the previous session's tabs** on launch — you usually land in a
  real repo tab, not the Welcome screen. Click `.tab-home` to reach Welcome, then click
  the recent-repo `button` by folder name. Do NOT click `.tab-new` — it opens a native
  file dialog you can't drive.
- To make a test repo appear in the recent list, prepend its absolute path to
  `%APPDATA%\git-gud\recent-projects.json` (backup first, restore after).
  **No UTF-8 BOM** — `Out-File -Encoding utf8` in PS 5.1 writes a BOM and the main
  process `JSON.parse` fails silently (empty recent list). Use
  `[IO.File]::WriteAllText(path, txt, New-Object System.Text.UTF8Encoding($false))`.
- Useful selectors: `.commit-row`, `.cr-message`, `.graph-scroll` (vertical scroller),
  `.graph-canvas` (node/line canvas), `.tab-home`, sidebar `.commit-row` context menus.
- A repo with history for graph testing: generate ~150 commits + branches/merge in the
  scratchpad with a bash loop (fast enough), don't reuse the user's repos.

## Clean up (user state you touched)

- Kill only the instance you launched:
  `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ? { $_.CommandLine -match '9223' } | % { Stop-Process -Id $_.ProcessId -Force }`
- Restore `%APPDATA%\git-gud\recent-projects.json` from your backup.
- The app also persists open tabs in `%APPDATA%\git-gud\open-tabs.json` — remove your
  test-repo tab and reset `active`, or the user's next launch opens your scratchpad repo.
