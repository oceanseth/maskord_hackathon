# ─── CloudFront Function: Redirect apex → www ────────────────────────────────

resource "aws_cloudfront_function" "apex_redirect" {
  name    = "maskord-apex-to-www"
  runtime = "cloudfront-js-2.0"
  comment = "Apex redirect + /app SPA routing"
  publish = true
  code    = <<-EOF
    function handler(event) {
      var request = event.request;
      var host    = request.headers.host.value;
      var uri     = request.uri;

      // ── 1. Apex → www redirect (preserve query string for OAuth callbacks) ──
      if (host === "maskord.com") {
        var qs = "";
        var q  = request.querystring;
        if (q) {
          var parts = [];
          for (var k in q) {
            var v = q[k];
            var vals = v.multiValue || [v];
            for (var i = 0; i < vals.length; i++) {
              parts.push(k + "=" + vals[i].value);
            }
          }
          if (parts.length) qs = "?" + parts.join("&");
        }
        return {
          statusCode: 301,
          statusDescription: "Moved Permanently",
          headers: { location: { value: "https://www.maskord.com" + uri + qs } }
        };
      }

      // ── 2. /app SPA routing — serve /app/index.html for any path that
      //       doesn't look like a direct file (no extension after last slash) ──
      if (uri === "/app" || uri === "/app/") {
        request.uri = "/app/index.html";
        return request;
      }
      if (uri.startsWith("/app/")) {
        var lastSlash = uri.lastIndexOf("/");
        var basename  = uri.substring(lastSlash + 1);
        if (basename.indexOf(".") === -1) {
          request.uri = "/app/index.html";
          return request;
        }
      }

      return request;
    }
  EOF
}

resource "aws_cloudfront_distribution" "website" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class
  comment             = "Maskord website - ${var.environment}"
  aliases             = [var.domain_name, var.www_subdomain]

  # ─── Origin: S3 via OAC ──────────────────────────────────────────────────

  origin {
    domain_name              = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id                = "S3-${var.s3_bucket_name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.website.id
  }

  # ─── Default Cache Behaviour ──────────────────────────────────────────────

  default_cache_behavior {
    target_origin_id       = "S3-${var.s3_bucket_name}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized (AWS managed)
    origin_request_policy_id   = "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf" # CORS-S3Origin (AWS managed)
    response_headers_policy_id = aws_cloudfront_response_headers_policy.website.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.apex_redirect.arn
    }
  }

  # ─── Custom Error Pages (SPA routing — return index.html for 404/403) ───

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  # ─── TLS Certificate ──────────────────────────────────────────────────────

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.website.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  # ─── Geo Restriction (none) ───────────────────────────────────────────────

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  depends_on = [aws_acm_certificate_validation.website]
}

# ─── Security Response Headers Policy ────────────────────────────────────────

resource "aws_cloudfront_response_headers_policy" "website" {
  name = "maskord-security-headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}
