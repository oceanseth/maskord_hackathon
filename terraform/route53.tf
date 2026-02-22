# Route53 zone data source is declared in acm.tf
# (data.aws_route53_zone.maskord)

# ─── Apex domain: maskord.com → CloudFront ────────────────────────────────────

resource "aws_route53_record" "apex_a" {
  zone_id = data.aws_route53_zone.maskord.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.website.domain_name
    zone_id                = aws_cloudfront_distribution.website.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_aaaa" {
  zone_id = data.aws_route53_zone.maskord.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.website.domain_name
    zone_id                = aws_cloudfront_distribution.website.hosted_zone_id
    evaluate_target_health = false
  }
}

# ─── www.maskord.com → CloudFront ─────────────────────────────────────────────

resource "aws_route53_record" "www_a" {
  zone_id = data.aws_route53_zone.maskord.zone_id
  name    = var.www_subdomain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.website.domain_name
    zone_id                = aws_cloudfront_distribution.website.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_aaaa" {
  zone_id = data.aws_route53_zone.maskord.zone_id
  name    = var.www_subdomain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.website.domain_name
    zone_id                = aws_cloudfront_distribution.website.hosted_zone_id
    evaluate_target_health = false
  }
}
