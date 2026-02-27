output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (needed for cache invalidation in deploy script)"
  value       = aws_cloudfront_distribution.website.id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.website.domain_name
}

output "s3_bucket_name" {
  description = "S3 bucket name for website files"
  value       = aws_s3_bucket.website.bucket
}

output "s3_bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.website.arn
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN"
  value       = aws_acm_certificate.website.arn
}

output "website_url" {
  description = "Live website URL"
  value       = "https://${var.domain_name}"
}

output "turn_server_ip" {
  description = "Elastic IP of the TURN server — use in Firestore _config/turn"
  value       = aws_eip.turn.public_ip
}
