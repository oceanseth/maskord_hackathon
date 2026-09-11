# The game rooms

Two "fun build" modes share one substrate: the **debate** (`/debate.html`,
second screen `/debatestats.html`) and the **D&D table** (`/wizard.html`,
battle map `/wizardmap.html`). This directory is the client half; the server
half is in `www/convex/`.

## One page = the client + a room column

`RoomShell` mounts the full Maskord client (`../App`) and, once the person is
signed in through Firebase, renders the room beside it. So a room page has
every client feature (servers, channels, voice, masks) and the room joins as
the signed-in human. There is no separate room login, and the guest button
works here exactly as on `/app/` (it needs `VITE_DEFAULT_INVITE_CODE` at build
time).

`mountRoomPage` wraps the tree in a `ConvexProvider` whose client
(`./convex.ts`) always talks to prod in production builds and to
`VITE_CONVEX_URL` only under `vite` dev.

## Files

| File | Role |
|------|------|
| `RoomShell.tsx` | Mounts the client, exposes the signed-in identity to the room, `mountRoomPage`. |
| `useRoom.ts` | Ensures/joins the room for this page, subscribes to members and events, heartbeats, claims and releases the turn. `roomSlugFromLocation(kind)` turns `?room=name` into the slug. |
| `RoomPanel.tsx` | The generic room UI every kind shares: status header with pause/resume, member strip, event log, say/act input. Kind-specific pages add `header`/`footer` and can override `renderEvent`. |
| `convex.ts` | The Convex client and the per-tab `runnerId`. |
| `pages/debate.tsx`, `pages/debatestats.tsx` | The debate and its spectator screen. All debate state is in the room's `config` plus the event log, so the stats page is a pure reader. |
| `pages/wizard.tsx`, `pages/wizardmap.tsx` | The D&D table and its map screen. |
| `wizard/` | Table-only UI: `Lobby`, `SheetCard`, `GamePanel`, `TileMap`, `useWizard`, and `theme.css` (every rule scoped under `.kf`, so it cannot leak into the client or the debate). |

Server side, in `www/convex/`:

| Module | Role |
|--------|------|
| `rooms.ts` | `rooms`, `roomMembers`, `roomEvents` tables. `ensure` (idempotent create), `join`, `heartbeat`, `post`, the event log, and the turn claim. |
| `agent.ts` | Inference for both modes: `runTurn` builds the prompt, calls Anthropic directly (`ANTHROPIC_API_KEY`) or the Firebase bridge, and writes the result back. `hasInference(guildId)` is the gate; `capabilities` is the public readout. |
| `research.ts` | The Linkup loop (store findings, pick the next query from the gaps). `hasResearch()`. |
| `cast.ts` | The three house masks that fill empty seats in either mode: Blackbeard, Wizard Zeus, Batman. |
| `debate.ts` | Motion, panel, turns, fact-checks, verdict. |
| `wizard.ts`, `wizard/{engine,pregens,scenario,types}.ts` | The D&D table: lobby and sheets, the 5e combat engine, the scripted DM, Dragons of Stormwreck Isle content. State lives in the `wizardGames` table. |

## Rules that hold the two modes apart

- **Slugs are namespaced by kind.** A room's slug is `<kind>:<name>`, so
  `?room=friday` is `debate:friday` on one page and `wizard:friday` on the
  other. `rooms.ensure` rejects a slug that does not start with the room's
  kind, so this is an invariant, not a convention.
- **Neither mode imports the other.** `debate.ts` and `wizard.ts` both import
  from `rooms`, `agent`, `research` and `cast`, never from each other. On the
  client, `pages/debate*.tsx` never import from `wizard/`.
- **Shared things live in shared modules.** If both modes need it, it goes in
  `rooms.ts`, `agent.ts`, `research.ts`, `cast.ts`, or this directory's top
  level, not under `wizard/` or in `debate.ts`.
- **Rooms depend on the client; the client never depends on rooms.** Importing
  `../App`, `../store/app`, `../components/pro/*` from here is fine. Nothing
  under `app/desktop/src` outside this directory may import from `rooms/`, and
  no main-app Convex module reads a room table.

## How a turn happens

Turns are driven by the server, not by a browser tab, so a room keeps moving
after the last human closes the page.

1. A mode's mutation decides who acts and schedules the work with
   `ctx.scheduler.runAfter`. A mask turn goes to `internal.agent.runTurn` with
   the mode's system prompt and one tool (`take_turn` for the table, `research`
   for the debate, which a debater may or may not call). Monsters, the DM's
   narration and the verdict are internal functions of the mode.
2. Scheduled work carries a token for the turn it was issued for (the table's
   `turnToken`) and bails if the room has moved on or is no longer `running`,
   so pause really stops everything.
3. Everything visible is appended to `roomEvents`. Spectator pages subscribe to
   the same log; there is no second source of truth.

The two modes serialise turns differently:

- **Debate:** every open tab runs the advance timer, so `debate.takeTurn`
  writes the room's `turn` claim itself and returns early while one is held
  (`TURN_CLAIM_TTL_MS`, 20 s). It is a lease with a TTL and no release, because
  `runTurn` is shared and cannot hand it back; a crashed turn expires instead
  of wedging the room.
- **D&D table:** one `wizardGames` row owns whose turn it is; scheduled work
  carries the `turnToken` it was issued for and bails if the table has moved on.

`rooms.claimTurn` / `releaseTurn` are exposed by `useRoom` for a client-driven
runner, but as of 2026-09-11 nothing calls them.

## Direction (Seth, 2026-09-11)

The separate pages were the fastest way to ship without touching `/app/`, not
the final shape. Seth wants the D&D table to be a **channel mode**: a Mode
dropdown in the create-channel popup, the game rendered in place of the chat
room for that channel, and the channel's own messages and voice feeding the
game. The agreed shape is `mode` as a field on the channel document (not a new
channel `type`), a third branch in `MainLayout` beside `TextChannel` and
`VoiceChannel`, and the room bound to the channel by id (slug
`wizard:ch-<channelId>`). `/wizard.html` stays alive until the in-channel
version works.

**Dice are rolled by the server, never by a mask.** A mask declares intent
through the tool call; the engine in `wizard/engine.ts` rolls, resolves and
records the numbers in the transcript.

## Running without a model

`agent:capabilities` on prod reports `inference`, `research` and `via`. Both
modes are built to run with all three false: humans can join, speak, take the
floor, roll and fight; masks keep their seats and fall back to scripted
behaviour. Any code path that needs a model must check
`hasInference(config.guildId)` first, and anything that schedules research must
check both `hasResearch()` and `hasInference` (a research result is useless
without a model to read it, and scheduling it anyway leaves error lines in the
transcript).

## Local verification

There is no test suite. Run a local backend (`CONVEX_AGENT_MODE=anonymous npx
convex dev` in `www/`), then `npm run dev:rooms --workspace=app/desktop`, open
`http://localhost:<port>/wizard.html?room=test` or `/debate.html?room=test`,
sign in or use the guest button, and play. `npx convex run wizard:...` and
`debate:...` drive the server side directly. Before pushing, `cd www && npm run
build` (this is what CI runs, and it type-checks `www/convex/`).
