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

# ─── Step 1: Install www dependencies ────────────────────────────────────────

echo "📦 Installing dependencies..."
cd "${WWW_DIR}"
npm install --silent

# ─── Step 2: Build ───────────────────────────────────────────────────────────

echo "🔨 Building Vite app..."
npm run build

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "❌ Build failed — dist/ directory not found"
  exit 1
fi

echo "✅ Build complete ($(du -sh "${DIST_DIR}" | cut -f1) total)"

# ─── Step 3: Sync to S3 ──────────────────────────────────────────────────────

echo ""
echo "☁️  Syncing to S3..."

# Sync non-HTML assets with long cache (1 year) — Vite includes content hashes in filenames
aws s3 sync "${DIST_DIR}/assets" "s3://${S3_BUCKET}/assets" \
  --delete \
  --region "${AWS_REGION}" \
  --cache-control "public, max-age=31536000, immutable" \
  --quiet

# Sync HTML and other files with short cache (5 minutes)
aws s3 sync "${DIST_DIR}" "s3://${S3_BUCKET}" \
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
echo "   https://maskord.com"
echo ""
