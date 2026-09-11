# Skillfiles

One markdown file per `<kind>/<phase>` is the orchestrator's system prompt while a
channel is in that phase. The file is the *static* part; the kind module
(`wizard.ts`, `debate.ts`) appends a `## State` section with the live roster,
seats, findings and whatever else the phase needs, and passes the whole thing
as `system` to `agent.runTurn`.

The only substitution the loader makes is `{{host}}`, the room's host name.

Convex bundles functions with esbuild, which has no loader for `.md`, so
`scripts/gen-skills.mjs` inlines these files into `_generated.ts`. `npm run
build` runs it; run it by hand after editing a file during `npx convex dev`.
