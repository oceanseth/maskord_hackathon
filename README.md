# maskord_hackathon

Maskord's Burning Token 2026 fork, branched from `oceanseth/maskord` so sponsor
integrations can be built — and abandoned — without touching the product repo.

Maskord is a replacement for Discord with true end-to-end encryption and
anonymity. Even in voice channels with many users the audio cannot be read by
anyone in the middle; it is only sent between people on the call. On top of
that, Maskord lets you speak or be seen as an avatar from masky.ai, so you can
wear whatever mask you like when interacting with others.

If you are an agent, read [`AGENTS.md`](AGENTS.md) after this. It is the short
list of things that have already cost people time here.

## What is live

| URL | What it is | Built from |
|-----|-----------|-----------|
| https://hackathon.maskord.com | The site. Root is the sponsor plan: what each sponsor does inside Maskord, the entry requirement it satisfies, how a judge verifies it. | `www/` |
| `/app/` (also `/server`) | The Maskord web client, with Convex-backed file sharing added. | `app/desktop`, web build |
| `/channel` | Public demo channel: no login, drag and drop a file. | `www/src/channel` |
| `/debate.html`, `/debatestats.html` | Masks argue a motion, fact-check each other, Masky judges. Second screen for spectators. | `app/desktop`, rooms build |
| `/wizard.html`, `/wizardmap.html` | Masks and humans play D&D (Dragons of Stormwreck Isle) with a scripted DM. Second screen is the battle map. | `app/desktop`, rooms build |
| https://impressive-skunk-614.convex.site | The Convex origin. CloudFront in front of it only terminates TLS for the vanity name. This URL is the Convex challenge eligibility evidence. | |

Room pages take `?room=<name>` so several tables or debates can run at once;
anyone with the link can join.

## Layout

| Path | What it is |
|------|-----------|
| `www/` | The site: sponsor plan (`src/hackathon`), public demo channel (`src/channel`), and the Convex backend. Its build folds the other two bundles in (see below). |
| `www/convex/` | Convex schema and functions. One backend for everything: demo channel, file sharing, presence, the game rooms, Linkup research, RevenueCat checks. |
| `app/desktop/` | The Maskord client (Electron and web). The four room pages are also here (`wizard.html`, `debate.html`, …) with their code under `src/rooms/`. |
| `app/shared/` | Firebase init, hooks and types shared by the clients. This is where the Firebase project id lives. |
| `app/mobile/` | The React Native client. Not built or deployed by anything in this repo. |
| `firebase/` | Firestore/RTDB rules and Cloud Functions for the **product** Firebase project. The authoritative rules live in the `masky_auth` repo. `roomTurn.ts` is the inference bridge for the rooms (not deployed as of 2026-09-11). |
| `scripts/` | `provision-maskord-server.mjs` (creates the shared default server, run once). `deploy.sh` deploys to the **product** S3 bucket: do not run it from here. |
| `terraform/` | Upstream maskord.com infrastructure. Do not apply from this repo. |
| `.github/workflows/` | `deploy-convex.yml` is the only deploy. `electron-release.yml` only fires on a `production` branch, which this repo does not have. |

## Three Vite builds, one published directory

Convex Static Hosting publishes one directory, `www/dist`. Three separate Vite
builds fill it. They share no chunks, so a change to a room page cannot alter a
byte of the client at `/app/`.

| Bundle | Config | Entry | `base` | Output | Lands at |
|--------|--------|-------|--------|--------|----------|
| site | `www/vite.config.ts` | `www/index.html` | `/` | `www/dist` | `/`, `/channel` |
| client | `app/desktop/vite.web.config.ts` | `app/desktop/index.html` | `/app/` | `app/desktop/dist-web` | `www/dist/app/` |
| rooms | `app/desktop/vite.rooms.config.ts` | `app/desktop/{wizard,wizardmap,debate,debatestats}.html` | `/rooms/` | `app/desktop/dist-rooms` | pages at `www/dist/*.html`, assets under `www/dist/rooms/` |

`www/scripts/build-app.mjs` runs the client and rooms builds and copies them
into place. It is the last step of `npm run build` in `www/`, so `cd www && npm
run build` is the whole site.

Two consequences that are not obvious from the tree:

- **A file's bundle decides its aliases.** `@maskord/shared` and
  `@maskord/convex` are aliased per config. Something that resolves in the rooms
  bundle can fail in the client bundle if the alias is missing there.
- **Only `www/` runs `tsc`.** The client and rooms builds are `vite build`
  alone. `www/tsconfig.json` includes only `src`, but `src/channel/ChannelView.tsx`
  imports `convex/_generated/api`, so every file under `www/convex/` is
  type-checked with `noUnusedLocals` and `noUnusedParameters` on. `tsc -p
  convex/tsconfig.json` passing is not enough; two commits on `main` exist only
  to remove an unused import that broke the deploy.

## Two databases, joined by uid

| Store | Holds | Where it is configured |
|-------|-------|------------------------|
| Convex, prod deployment `impressive-skunk-614` (team `seth-ff468`, project `maskord-hackathon`) | Demo channel messages and files, presence, rooms and their event logs, research findings, D&D game state, rentable masks | `www/convex/`, `www/.env.local` for dev |
| Firebase project `maskydotnet` (Firestore + RTDB + Auth) | Users, guilds (servers), channels, friendships, invites, the masky.ai avatars, the `claudeApiKey` a server owner types into Server Settings → AI Assistance | `app/shared/src/firebase/config.ts`, `firebase/` |

**`maskydotnet` is the production Firebase project.** It is the same one
behind masky.ai and maskord.com; users, avatars and servers are shared with the
live product (Seth, 2026-09-11). A rules or functions deploy from `firebase/`
in this repo changes production. The authoritative rules live in the
`masky_auth` repo.

Every signed-in identity is a Firebase user. Convex rows point back at it by
uid (`ownerUid`, `memberKey`). Two things that bite:

- **A uid is not always a Firebase Auth uid.** Twitch-linked accounts have ids
  like `twitch:11867613`, with the handle in `twitchUsername`. Guild ownership
  is a literal `guild.ownerId === firebaseUser.uid`, so the same person signed in
  through Google and through Twitch is two users, and only one of them owns the
  server.
- **Admin access to Firestore needs no service account.**
  `scripts/provision-maskord-server.mjs` reuses the refresh token `firebase
  login` stored on the machine, against the Firestore REST API. Copy its auth
  block rather than hunting for credentials. A REST `PATCH` **without
  `updateMask.fieldPaths` replaces the whole document**; editing one field the
  naive way can delete a guild's settings.

## Which backend am I talking to?

Production bundles always talk to the prod Convex deployment. Both
`app/desktop/src/rooms/convex.ts` and `www/src/channel/session.ts` hardcode
`impressive-skunk-614` behind `import.meta.env.PROD`. `VITE_CONVEX_URL` in
`www/.env.local` only affects `vite` dev servers.

So `.env.local` tells you nothing about what the live site uses, and there is
no way to point the deployed site at a dev deployment by accident.

Environment variables live on a deployment, not in the repo and not on a
branch. A cloud dev deployment (`quiet-mole-409`) exists from initial setup;
Seth has said it should be deleted (2026-09-11), so do not rely on it. Use the
local anonymous backend for development (below), and always check `--prod` for
what the site can see:

```bash
cd www
npx convex env list          # whatever deployment .env.local points at
npx convex env list --prod   # impressive-skunk-614, what the site uses
```

"The key is set" and "the running code can see the key" are separate claims;
check `--prod`.

To read prod without a deploy key or a configured `CONVEX_DEPLOYMENT`, call a
public query directly:

```bash
curl -s -X POST https://impressive-skunk-614.convex.cloud/api/query \
  -H 'content-type: application/json' \
  -d '{"path":"agent:capabilities","args":{},"format":"json"}'
# {"status":"success","value":{"inference":false,"research":true,"via":"none"}}
```

## Merging to `main` is deploying

`.github/workflows/deploy-convex.yml` runs on every push to `main` that touches
`www/`, `app/`, the root `package.json`/lock, or itself. It runs `npx convex
deploy`, then `npm run build` in `www/`, then uploads `www/dist`. There is no
staging step and no branch preview: a feature branch cannot be seen on
hackathon.maskord.com until it is merged. Keep `main` green.

It needs one secret, `CONVEX_DEPLOY_KEY`, and one repository variable,
`DEFAULT_INVITE_CODE`: the guest button in the client exists only if that was
set at build time. See `.github/workflows/README.md` for why the upstream S3 and
Terraform workflows were deleted.

By hand, if the workflow is down:

```bash
cd www
npx convex deploy -y
npm run build
npx @convex-dev/static-hosting upload --prod -d ./dist
```

Do not use `upload --build`: that flag runs Vite itself and skips the script
that folds the client and rooms in.

## Local development

```bash
npm ci                                             # root; npm workspaces
cd www
CONVEX_AGENT_MODE=anonymous npx convex dev         # local backend, no Convex account needed
```

That writes `www/.env.local` pointing `VITE_CONVEX_URL` at `http://127.0.0.1:3210`
and keeps the backend alive while it runs. Leave it running; `npx convex dev
--once` stops the local backend when it exits and takes anything connected to
it down with it. Without `CONVEX_AGENT_MODE=anonymous`, `npx convex dev` wants
a Convex login and uses the cloud dev deployment instead.

Then in a second shell:

```bash
npm run dev:web                                    # the site, www/
npm run dev:rooms --workspace=app/desktop          # the four room pages
npm run dev:desktop                                # the client
```

Dev servers read `.env.local`; the production build does not (see above).

Sign-in is Firebase in every bundle, dev included, so local work still needs a
masky.ai account or the guest button. The guest button needs
`VITE_DEFAULT_INVITE_CODE` in the environment at build or dev time.

### Verifying a change

There is no test suite and no `npm test`. The only automated check is the
build, so before pushing anything CI will merge:

```bash
cd www && npm run build
```

Behaviour is verified by hand against the local backend (or on prod after a
merge). Convex functions can be driven directly:

```bash
cd www && npx convex run rooms:list '{}'           # against the deployment in .env.local
```

## Keys and environment

Secrets live only in deployment environment variables, never in Convex tables,
never in the bundle, never in git (the repo is public).

| Variable | Where | Purpose |
|----------|-------|---------|
| `ANTHROPIC_API_KEY` | Convex prod env | Option A for room inference: masks and the DM think through `convex/agent.ts`. |
| `ANTHROPIC_MODEL`, `ANTHROPIC_JUDGE_MODEL` | Convex env | Override the speaking and judging models without a deploy. |
| `ROOM_BRIDGE_URL`, `ROOM_BRIDGE_SECRET` | Convex prod env | Option B: rooms POST to `firebase/functions/src/roomTurn.ts`, which spends the `claudeApiKey` a server owner typed into Server Settings. Needs the function deployed with `ROOM_BRIDGE_SECRET` and `ROOM_BRIDGE_GUILDS` (fails closed). |
| `LINKUP_API_KEY` | Convex prod env | Fact-checks and rules lookups (`convex/research.ts`). |
| `REVENUECAT_SECRET_KEY`, `REVENUECAT_PROJECT_ID` | Convex prod env | Server-side Maskord Pro check (`convex/pro.ts`). `sk_` keys work only with RevenueCat API v2. |
| `CONVEX_DEPLOY_KEY` | GitHub secret | The deploy workflow. |
| `DEFAULT_INVITE_CODE` | GitHub variable | Guest access to the shared server. Not a secret. |

`agent.hasInference(guildId)` gates every mask turn: true if the deployment has
`ANTHROPIC_API_KEY`, or the room recorded a guild and the bridge is configured.
Nothing speaks until one of those is true, and the rooms are built to run
without it: humans can play, dice roll, transcripts fill, masks fall back to
scripted behaviour. `agent:capabilities` reports which path is active (`via:
deployment | server | none`).

Status on 2026-09-11: the chosen path is B. Seth has put the Anthropic key on
the default Maskord server (Server Settings → AI Assistance), so the remaining
steps are deploying `roomTurn` with its two secrets and setting
`ROOM_BRIDGE_URL` / `ROOM_BRIDGE_SECRET` on Convex prod. Until then prod
reports `via: "none"`.

The client's RevenueCat key in `app/desktop/src/lib/purchases.ts` is a public
Test Store key, intentionally, for the hackathon.

## Sponsors

The site root renders all six briefs (Nebius, Render, Convex, Linkup,
RevenueCat, NERDCONF) from `www/src/hackathon/challenges.ts`, each with the
official requirement and what it becomes inside Maskord. The Convex static
hosting requirement is met by the origin above; Linkup runs the research loop;
RevenueCat gates Maskord Pro and the rentable-mask shelf.
