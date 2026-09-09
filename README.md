# maskord_hackathon

Maskord's Burning Token 2026 fork, branched from `oceanseth/maskord` so sponsor
integrations can be built — and abandoned — without touching the product repo.

Maskord is a replacement for Discord with true end-to-end encryption and
anonymity. Even in voice channels with many users the audio cannot be read by
anyone in the middle; it is only sent between people on the call. On top of
that, Maskord lets you speak or be seen as an avatar from masky.ai, so you can
wear whatever mask you like when interacting with others.

- **Live:** https://hackathon.maskord.com
- **Convex origin:** https://impressive-skunk-614.convex.site
- **Sponsor plan:** the site root — what each sponsor does inside Maskord, the
  official entry requirement it satisfies, and how a judge verifies it.
- **The app:** `/server` — the Maskord web client, with Convex-backed file
  sharing added.
- **Public demo channel:** `/channel` — no login, drag and drop a file.

## Layout

| Path | What it is |
|------|-----------|
| `www/` | Marketing site, the sponsor plan page, and the Convex backend. |
| `www/convex/` | Convex schema and functions — see its README for deploy steps. |
| `app/desktop` | The Maskord client. `build:web` produces the browser build. |
| `app/shared` | Firebase hooks and types shared by the clients. |
| `firebase/` | Firestore/RTDB rules and Cloud Functions. Note that the authoritative rules live in the `masky_auth` repo. |
| `terraform/` | Upstream maskord.com infrastructure. Do not apply from this repo. |

## Deploying

Push to `main`. Anything touching `www/` publishes to the prod Convex
deployment, which is what hackathon.maskord.com serves — see
`.github/workflows/README.md`.

By hand, if needed:

```bash
cd www
npx convex deploy -y
npx @convex-dev/static-hosting upload --build --prod -d ./dist
```
