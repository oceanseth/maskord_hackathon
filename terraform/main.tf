terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "maskord-terraform-state"
    key            = "maskord/website/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "maskord-terraform-locks"
  }
}

# Primary region for all resources
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Maskord"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# ACM certificates for CloudFront MUST be in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "Maskord"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
