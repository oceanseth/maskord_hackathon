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

## Pointing hackathon.maskord.com at it

Two ways, and they differ in cost:

**A. Convex custom domain — requires a Convex Pro plan.**
Deployment Settings → Custom Domains → add `hackathon.maskord.com`. Convex then
shows the DNS records to create; add them in Route 53 zone
`Z08097413E7LZC3FNHC9X`. Convex mints the certificate itself, so the ACM
certificate below is not used. Override `CONVEX_SITE_URL` to the custom domain.
See https://docs.convex.dev/production/custom-domains

**B. CloudFront in front of Convex — no Convex plan needed.**
A CloudFront distribution with alias `hackathon.maskord.com` and a custom origin
of `<deployment>.convex.site`, using the already-issued ACM certificate
`arn:aws:acm:us-east-1:218827615080:certificate/7a5bdcda-e57d-402b-b8e8-fb5e1829a293`
(us-east-1, DNS-validated in the maskord.com zone). Convex still serves every
byte; CloudFront only terminates TLS for the vanity hostname.

Either way the Route 53 record cannot be created until the Convex deployment
exists — there is no target hostname before that.

## Notes

- `convex/` is outside `www/tsconfig.json`'s `include`, so it does not affect
  the Vite/S3 build.
- `convex/_generated/` is created by the first `npx convex dev` or
  `npx convex deploy`.
