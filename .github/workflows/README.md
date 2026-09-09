# Workflows

`deploy-convex.yml` is the only deploy in this repo. A push to `main` that
touches `www/` publishes to the prod Convex deployment, which is what
hackathon.maskord.com serves. It needs one secret, `CONVEX_DEPLOY_KEY`, scoped
to that deployment.

## What was removed, and why

The upstream `oceanseth/maskord` workflows came along with the fork:

- `deploy.yml` uploaded `www/dist` to the `maskord-website-prod` S3 bucket —
  the bucket behind **maskord.com**, the live product site.
- `terraform.yml` ran `terraform apply` against the live maskord.com AWS
  infrastructure.

Both were configured for production maskord.com, not for this fork. A push to
`production` here would have overwritten the real site, so they were deleted
rather than left as a trap. They are untouched in the product repo, where they
belong.

## No CloudFront invalidation step

CloudFront sits in front of the Convex origin only to terminate TLS for
hackathon.maskord.com. Convex serves `index.html` with
`cache-control: public, max-age=0, must-revalidate` and content-hashed asset
filenames, so a new deploy is picked up without an invalidation. That is why
this workflow needs no AWS credentials at all.

If a deploy ever appears stale, invalidate by hand:

```bash
aws cloudfront create-invalidation --distribution-id E23OQTGY3MVJNY --paths "/*"
```
