#!/usr/bin/env bash
# deploy.sh — Build Maskord website and deploy to S3 + CloudFront
#
# Required environment variables:
#   AWS_ACCESS_KEY_ID       — AWS credentials
#   AWS_SECRET_ACCESS_KEY   — AWS credentials
#   AWS_REGION              — e.g. us-east-1
#   S3_BUCKET               — e.g. maskord-website-prod
#   CF_DISTRIBUTION_ID      — CloudFront distribution ID (from terraform output)
#
# Usage:
#   ./scripts/deploy.sh
#   S3_BUCKET=maskord-website-prod CF_DISTRIBUTION_ID=EXXXXXXX ./scripts/deploy.sh

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WWW_DIR="${REPO_ROOT}/www"
DIST_DIR="${WWW_DIR}/dist"
DESKTOP_DIR="${REPO_ROOT}/app/desktop"
WEB_DIST_DIR="${DESKTOP_DIR}/dist-web"

S3_BUCKET="${S3_BUCKET:-maskord-website-prod}"
CF_DISTRIBUTION_ID="${CF_DISTRIBUTION_ID:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# ─── Validate ─────────────────────────────────────────────────────────────────

if [[ -z "${CF_DISTRIBUTION_ID}" ]]; then
  echo "❌ CF_DISTRIBUTION_ID is required"
  echo "   Get it from: cd terraform && terraform output cloudfront_distribution_id"
  exit 1
fi

echo ""
echo "🎭 Maskord Website Deploy"
echo "   Bucket: s3://${S3_BUCKET}"
echo "   CloudFront: ${CF_DISTRIBUTION_ID}"
echo "   Region: ${AWS_REGION}"
echo ""

# ─── Step 1: Install dependencies ────────────────────────────────────────────

echo "📦 Installing dependencies (www)..."
cd "${WWW_DIR}"
npm install --silent

echo "📦 Installing dependencies (app/desktop)..."
cd "${DESKTOP_DIR}"
npm install --silent

# ─── Step 2: Build www (landing page) ────────────────────────────────────────

echo "🔨 Building landing page..."
cd "${WWW_DIR}"
npm run build

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "❌ Landing page build failed — dist/ directory not found"
  exit 1
fi

echo "✅ Landing page built ($(du -sh "${DIST_DIR}" | cut -f1) total)"

# ─── Step 3: Build web app ────────────────────────────────────────────────────

echo "🔨 Building web app..."
cd "${DESKTOP_DIR}"
npm run build:web

if [[ ! -d "${WEB_DIST_DIR}" ]]; then
  echo "❌ Web app build failed — dist-web/ directory not found"
  exit 1
fi

echo "✅ Web app built ($(du -sh "${WEB_DIST_DIR}" | cut -f1) total)"

# ─── Step 4: Sync to S3 ──────────────────────────────────────────────────────

echo ""
echo "☁️  Syncing to S3..."

# Landing page — hashed assets get long cache; HTML gets short cache
aws s3 sync "${DIST_DIR}/assets" "s3://${S3_BUCKET}/assets" \
  --delete \
  --region "${AWS_REGION}" \
  --cache-control "public, max-age=31536000, immutable" \
  --quiet

aws s3 sync "${DIST_DIR}" "s3://${S3_BUCKET}" \
  --delete \
  --region "${AWS_REGION}" \
  --exclude "assets/*" \
  --exclude "app/*" \
  --cache-control "public, max-age=300, must-revalidate" \
  --quiet

# Web app — sync under /app/ prefix
aws s3 sync "${WEB_DIST_DIR}/assets" "s3://${S3_BUCKET}/app/assets" \
  --delete \
  --region "${AWS_REGION}" \
  --cache-control "public, max-age=31536000, immutable" \
  --quiet

aws s3 sync "${WEB_DIST_DIR}" "s3://${S3_BUCKET}/app" \
  --delete \
  --region "${AWS_REGION}" \
  --exclude "assets/*" \
  --cache-control "public, max-age=300, must-revalidate" \
  --quiet

echo "✅ S3 sync complete"

# ─── Step 4: Invalidate CloudFront cache ─────────────────────────────────────

echo ""
echo "🔄 Invalidating CloudFront cache..."

INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "${CF_DISTRIBUTION_ID}" \
  --paths "/*" \
  --query "Invalidation.Id" \
  --output text)

echo "✅ Invalidation created: ${INVALIDATION_ID}"
echo "   (Takes 1-5 minutes to propagate globally)"

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "🎉 Deploy complete!"
echo "   Landing page: https://maskord.com"
echo "   Web app:      https://maskord.com/app"
echo ""
