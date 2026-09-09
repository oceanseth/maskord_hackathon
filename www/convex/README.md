# Serving the site from Convex Static Hosting

**Live.** Team `seth-ff468`, project `maskord-hackathon`, prod deployment
`impressive-skunk-614`.

- Convex origin (eligibility evidence): https://impressive-skunk-614.convex.site
- Vanity domain: https://hackathon.maskord.com — CloudFront `E23OQTGY3MVJNY`
  in front of the Convex origin (route B below).

A second project, `maskord-hackathon-2131d`, was created by accident during
setup and is unused. Delete it from the dashboard if it is in the way.

## Redeploying

```bash
cd www
npx convex deploy -y
npx @convex-dev/static-hosting upload --build --prod -d ./dist
aws cloudfront create-invalidation --distribution-id E23OQTGY3MVJNY --paths "/*"
```

`upload` without `--build` fails to resolve the component; keep the flag.


The Convex "Multiplayer" challenge requires the frontend to be deployed on
Convex Static Hosting (`convex.site`), so this workspace can be published to
Convex as well as to S3 + CloudFront.

## First deploy

`npx convex login` opens a browser, so it cannot run in a headless session —
it has to be done once by a human on the machine that owns the Convex account.
The project also has to be created before deploying: without it the deploy
stops at `No CONVEX_DEPLOYMENT set`.

```bash
cd www
npx convex login                                              # once, interactive
npx convex dev --once --configure new --project maskord-hackathon  # writes .env.local
npm run deploy:convex                                         # builds www, deploys, uploads dist/
```

`deploy:convex` also works from the repo root, which forwards to the `www`
workspace.

The site is then live at `https://<deployment>.convex.site`. Keep that URL
working: the challenge brief names `convex.site` specifically, so it is the
eligibility evidence to cite in the submission even if a custom domain is
also pointed at it.

## How the vanity domains work

hackathon.masky.ai and hackathon.maskord.com both resolve to CloudFront
distribution `E23OQTGY3MVJNY`, whose only origin is `<deployment>.convex.site`.
Convex serves every byte; CloudFront exists solely to terminate TLS for the two
vanity hostnames, using one DNS-validated ACM certificate in us-east-1 that
covers both names. Route 53 zones: `masky.ai` and `maskord.com`.

The alternative — Convex's own custom-domain feature — was not used because it
[requires a Convex Pro plan](https://docs.convex.dev/production/custom-domains).
If you switch to it later, Convex mints its own certificate and the ACM one
becomes unnecessary; override `CONVEX_SITE_URL` to the custom domain.

Either way, cite the raw `*.convex.site` URL as the challenge eligibility
evidence — the brief names `convex.site` specifically, and a custom domain in
front of it is presentation rather than proof.

## Notes

- `convex/` is outside `www/tsconfig.json`'s `include`, so it does not affect
  the Vite/S3 build.
- `convex/_generated/` is created by the first `npx convex dev` or
  `npx convex deploy`.
