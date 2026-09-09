# No CI deploys in this repo

The upstream `oceanseth/maskord` workflows were removed here on purpose.
They deploy the marketing site to the `maskord-website-prod` S3 bucket and
run `terraform apply` against the live maskord.com infrastructure — from
this fork they would overwrite production.

This repo deploys to Convex Static Hosting instead. See `www/convex/README.md`.
