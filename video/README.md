# Video series

Everything that produces the Git Gud tutorial series: thirteen episodes,
about half an hour, narrated in the same voice as the htmlify tutorial.
The feature list the series follows is [docs/feature-list.md](../docs/feature-list.md).

| Path | What it is |
| --- | --- |
| `episodes/*.json` | One script per episode: sections of lines, each with what is said and either a take or an FX component to show. |
| `demo/build-demo.sh` | Builds the tidepool demo repo: history from four people, branches, tags, a stash, a worktree, a remote. |
| `tools/voice.mjs` | Narrates every line with a local Kokoro TTS server (voice `af_heart`), cached per line. |
| `tools/director.ts` | Records a page through the DevTools screencast, draws a cursor, and times actions to the narration's words. |
| `tools/app.ts` | Launches Git Gud from source with its own user data and answers its folder pickers. |
| `tools/takes/*.ts` | The takes for each episode, driving the real app, peers, daemon and phone. |
| `tools/record.ts` | Runs the takes. Checks every cue word against the narration first. |
| `tools/edit.ts` | Builds an episode's edit in Neon Video Studio and optionally renders it. |
| `tools/neon.ts` | neon-cli against this series' own Neon instance (`~/.neon-video-gitgud`). |
| `tools/render-all.sh` | Builds and renders every episode. |
| `tools/page.ts` | Builds the watch page: episodes, chapters, captions and an infographics gallery. |
| `tools/companion-web.sh` | Builds the companion app's web export for the phone scenes without changing the repo. |
| `tools/canvas-restore-check.ts` | Regression check for the blank-graph bug found while filming. |
| `fx/gitgud-fx` | Neon FX pack in Git Gud's colors: title, chapter label, cards and animated diagrams. |
| `stage/` | The terminal and phone frames the daemon and companion scenes are recorded in. |

## Make it again

Needs Docker, Neon Video Studio with `neon-cli` linked, and Bun.

```sh
pnpm --dir video install --ignore-workspace
docker run -d --rm --name kokoro-gitgud -p 8881:8880 ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0
pnpm build && pnpm build:headless
video/tools/companion-web.sh            # phone scenes
node video/tools/voice.mjs              # narration
node video/tools/record.ts              # all takes; name episode or episode:take to redo some
node video/tools/neon.ts serve --detach
video/tools/render-all.sh               # build/renders/<episode>.mp4
node video/tools/page.ts                # build/publish/
```

Change a line in an episode, rerun `voice.mjs`, re-record the take that
shows it, and rerender that episode. Every voice-over clip in the Neon
projects (`~/Videos/git-gud-series/`) is linked to its script line, so
Neon's prompter can re-record a line in your own voice.

## What's real and what's stood in

- Desktop scenes are Git Gud built from this checkout. Peer scenes run two real instances.
- The daemon scenes replay gitgud-headless's real output in the terminal frame.
- Gerrit's REST API is a small local stand-in, and GitHub sign-in is answered locally.
- The update scene sends the updater's own events with a pretend v1.22.0.
- The phone is the companion's web build. Browsers can't pin certificates, so the phone frame trusts exactly the host's certificate and adds the CORS headers a phone wouldn't need.
