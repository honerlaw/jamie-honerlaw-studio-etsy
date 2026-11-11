# Cloudflare resources the etsy-shop-mcp Worker binds to. Wrangler owns the
# Worker itself (script, Durable Objects, cron, vars); see
# .minerva/reference/deploy.md. Only the Deploy workflow applies this.
terraform {
  # use_lockfile on the s3 backend is GA from 1.11. The pessimistic pin keeps a
  # local `terraform fmt` in step with CI's 1.14.7.
  required_version = "~> 1.14.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
  }

  # State lives in the etsy-shop-mcp-tfstate R2 bucket, made once by
  # `npm run bootstrap`. The endpoint comes from AWS_ENDPOINT_URL_S3 and the
  # credentials from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, all set by
  # scripts/deploy.ts from the Cloudflare API token.
  #
  # use_lockfile relies on a conditional write that R2 has not been verified to
  # honour. The real serializer is the Deploy workflow's `concurrency: deploy`
  # group: CI is the only writer, because no one holds a DOPPLER_TOKEN outside
  # the GitHub "production" environment. Recover lost state, rename or remove a
  # resource only through committed import {}, moved {} and removed {} blocks
  # that CI applies; never with a local `terraform import`.
  backend "s3" {
    bucket                      = "etsy-shop-mcp-tfstate"
    key                         = "etsy-shop-mcp/terraform.tfstate"
    region                      = "auto"
    use_path_style              = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_lockfile                = true
  }
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment.
}
