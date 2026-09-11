# Working in this repo as an agent

Read `README.md` first; this file is only the rules and the traps. Everything
here was learned the expensive way during the hackathon (September 2026) by the
agents building it. If you learn a new one, add it here in the same PR as the
fix.

## Who is who

- **Seth Caldwell** (`oceanseth`) owns the repo, the Convex team, the Firebase
  project and the AWS account. Anything that needs a key, a secret, or an
  account goes through Seth.
- **rachael** is a collaborator with write access.
- Two agents work here and are named almost identically: **Claude-Fable**
  (Seth's) and **Claude-fable-r** (rachael's). Commits from either land under
  their owner's name. Coordination happens in the Buzz channel
  `BurningTokenHackathon`, not in GitHub comments.

## Never

- **Never run `scripts/deploy.sh`, `terraform apply`, or `firebase deploy`
  from this repo.** All three target the production maskord.com / masky.ai
  infrastructure, not the hackathon site. The Firebase project `maskydotnet`
  is shared with the live product: same users, avatars and servers. The
  upstream S3 and Terraform GitHub workflows were deleted for the same reason
  (`.github/workflows/README.md`). Deploying a Cloud Function (for example the
  `roomTurn` bridge) is Seth's call and Seth's action.
- **Never push to `main` directly.** A push to `main` is a production deploy
  (`deploy-convex.yml`). Work on a branch, open a PR, merge when `cd www && npm
  run build` passes.
- **Never put a key in a Convex table, a bundle, or git.** The repo is public.
  Keys go in the deployment environment (`npx convex env set NAME value
  --prod`) and are read only inside Convex actions or Cloud Functions.
- **Never edit `app/desktop/index.html` or `www/index.html` for feature
  work.** The client entry and the site root are what every visitor loads. New
  surfaces get their own HTML entry (see how the room pages are built).
- **Never `PATCH` a Firestore document over REST without
  `updateMask.fieldPaths`.** It replaces the whole document.

## Before you push

1. `cd www && npm run build` from a clean checkout of your branch. This is the
   exact command CI runs. It type-checks `www/convex/` through `www/src`'s
   import of `_generated/api`, with unused locals and parameters as errors, and
   it builds all three bundles. The client and rooms builds are `vite build`
   only: a type error in `app/desktop` that is not reachable from `www/src`
   does not fail CI. Check the client yourself with `npx tsc -p app/desktop
   --noEmit` from the repo root. It is clean on `main` **after a root `npm
   install`**; with a stale install it reports a missing
   `@revenuecat/purchases-js` and an `err is unknown` in `purchases.ts` that
   are install artefacts, not bugs.
2. If you touched `www/convex/`, confirm the local backend accepted it (`npx
   convex dev` prints the push result) and drive the changed function with
   `npx convex run`.
3. State in the PR what you verified and against which backend (local
   anonymous, cloud dev, or prod after merge). There is no test suite; a claim
   with no backend named is not a verification.

## Things that look wrong but are not

- **`.env.local` points at a dev or local deployment, yet the live site uses
  prod.** Correct. Production bundles hardcode `impressive-skunk-614` behind
  `import.meta.env.PROD`. Do not "fix" it.
- **`/wizard.html` is not under `www/`.** The room pages are
  `app/desktop/*.html`, built by `app/desktop/vite.rooms.config.ts`, and moved
  to the site root by `www/scripts/build-app.mjs`.
- **Room pages import from the client's tree.** By design: `RoomShell` mounts
  the whole client with the room as a second column, so rooms depend on the
  app. The direction that must hold is the reverse: nothing under
  `app/desktop/src` outside `rooms/` imports from `rooms/`, and no main-app
  Convex module (`messages`, `servers`, `presence`, `files`, `pro`) reads a room
  table.
- **`agent:capabilities` says `inference: false`, or masks say nothing.** That
  is the deployment's env or the server's key, not a bug in your code. Read
  the README's "Keys and environment" for the current path. Build so the
  feature still works without a model, gated by `agent.hasInference(guildId)`.
- **The same person does not own their own server.** Twitch sign-in gives uid
  `twitch:<id>`; Google sign-in gives a Firebase uid. Ownership is a literal uid
  compare. Same human, two users.

## Things that look fine but are wrong

- **`tsc -p www/convex/tsconfig.json` passes, so convex is fine.** No. That
  config has no unused checks; the root `www/tsconfig.json` does. Run the
  build.
- **"Nothing is live until someone deploys."** Merging is deploying.
- **`npx convex dev --once` to push a schema quickly.** Against the local
  anonymous backend it stops the backend on exit and kills every dev server
  connected to it. Keep one `CONVEX_AGENT_MODE=anonymous npx convex dev`
  running instead.
- **`npx convex env list` shows the key, so prod has it.** That is the dev
  deployment. Use `--prod`.
- **A RevenueCat `sk_` key against `/v1/subscribers/{id}`.** v1 rejects secret
  keys (code 7723). Use API v2, project-scoped; entitlements come back as ids,
  not lookup keys.
- **Running the web client dev server against a local Convex.** It loads, then
  every Convex call fails silently with `Failed to fetch`: `app/desktop/index.html`
  ships a CSP of `default-src 'self' https: wss:`, which blocks plain-http
  loopback. The room pages allow `ws://127.0.0.1:* http://127.0.0.1:*`; the
  client entry does not, and it is off-limits for feature work. Patch it in your
  working tree for the test and do not commit it. The dev server itself is
  `cd app/desktop && VITE_CONVEX_URL=http://127.0.0.1:3210 npx vite --config
  vite.web.config.ts`.
- **Convex custom domains instead of CloudFront.** They need Convex Pro, and the
  Convex challenge names `convex.site` as the eligibility evidence anyway. Cite
  the origin URL, not the vanity name.

## Where things are

| Need | Look at |
|------|---------|
| Room model (rooms, members, event log, turn lease) | `www/convex/rooms.ts`, `app/desktop/src/rooms/useRoom.ts` |
| Inference (both game modes) | `www/convex/agent.ts`; bridge in `firebase/functions/src/roomTurn.ts` |
| Linkup research loop | `www/convex/research.ts` |
| Debate | `www/convex/debate.ts`, `app/desktop/src/rooms/pages/debate*.tsx` |
| D&D table | `www/convex/wizard.ts`, `www/convex/wizard/*`, `app/desktop/src/rooms/wizard/*` |
| The three house masks (Blackbeard, Wizard Zeus, Batman) | `www/convex/cast.ts` |
| Maskord Pro / RevenueCat | `www/convex/pro.ts`, `www/convex/rentable.ts`, `app/desktop/src/lib/purchases.ts`, `app/desktop/src/components/pro/*` |
| Sponsor briefs shown on the site | `www/src/hackathon/challenges.ts` |
| How the site is assembled and deployed | `www/scripts/build-app.mjs`, `.github/workflows/deploy-convex.yml`, `www/convex/README.md` |
| The room architecture in detail | `app/desktop/src/rooms/README.md` |
