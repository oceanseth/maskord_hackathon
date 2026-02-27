variable "domain_name" {
  description = "Root domain name (e.g. maskord.com)"
  type        = string
  default     = "maskord.com"
}

variable "www_subdomain" {
  description = "WWW subdomain"
  type        = string
  default     = "www.maskord.com"
}

variable "s3_bucket_name" {
  description = "S3 bucket name for the website"
  type        = string
  default     = "maskord-website-prod"
}

variable "aws_region" {
  description = "AWS region for non-global resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "cloudfront_price_class" {
  description = "CloudFront price class (PriceClass_All = all edges, PriceClass_100 = cheapest)"
  type        = string
  default     = "PriceClass_100"  # US, Canada, Europe — cheapest
}

variable "turn_region" {
  description = "AWS region for the TURN server (ap-southeast-2 = Sydney, closest to AU users)"
  type        = string
  default     = "ap-southeast-2"
}

variable "turn_password" {
  description = "Long-term credential password for the coturn 'maskord' user"
  type        = string
  sensitive   = true
}

variable "turn_ssh_public_key" {
  description = "SSH public key to authorize on the TURN server (contents of ~/.ssh/id_ed25519.pub or similar)"
  type        = string
}
