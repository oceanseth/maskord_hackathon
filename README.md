# maskord_hackathon

Maskord's Burning Token 2026 fork. Forked from `oceanseth/maskord` so sponsor
integrations can be built, and abandoned, without touching the product repo.

- **Live:** https://hackathon.maskord.com
- **Convex origin:** https://impressive-skunk-614.convex.site
- **Sponsor plan:** the site root — what each sponsor does inside Maskord, the
  official entry requirement it satisfies, and how a judge verifies it.
- **Live channel:** `/channel` — no login. Messages, uploads and presence are
  held in Convex and sync to every open session.

## Layout

| Path | What it is |
|------|-----------|
| `www/` | The site and the Convex backend. This is what deploys. |
| `www/convex/` | Convex schema and functions — see its README for deploy steps. |
| `app/` | Desktop and mobile clients, inherited from upstream. Not part of the hackathon build. |
| `firebase/` | Firestore/RTDB rules for the upstream product. Auth and voice stay here. |
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
