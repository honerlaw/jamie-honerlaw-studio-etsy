# Staged phone-photo uploads (UPLOADS binding, wrangler.jsonc).
resource "cloudflare_r2_bucket" "uploads" {
  account_id = var.account_id
  name       = "etsy-shop-uploads"

  lifecycle {
    prevent_destroy = true
  }
}

# Uploads are only staged on the way to Etsy, so anything left behind goes after a day.
# This resource sets the bucket's whole rule list, so it also restates R2's default
# rule for new buckets (abort unfinished multipart uploads after 7 days).
resource "cloudflare_r2_bucket_lifecycle" "uploads" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.uploads.name
  rules = [{
    id      = "expire-staged-uploads"
    enabled = true
    conditions = {
      prefix = "uploads/"
    }
    delete_objects_transition = {
      condition = {
        type    = "Age"
        max_age = 86400
      }
    }
    }, {
    id      = "abort-unfinished-multipart-uploads"
    enabled = true
    conditions = {
      prefix = ""
    }
    abort_multipart_uploads_transition = {
      condition = {
        type    = "Age"
        max_age = 604800
      }
    }
  }]
}

# KV titles are unique per account, so lost state fails loudly on create
# instead of silently making empty namespaces.
resource "cloudflare_workers_kv_namespace" "oauth" {
  account_id = var.account_id
  title      = "etsy-shop-mcp-oauth"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_workers_kv_namespace" "shop" {
  account_id = var.account_id
  title      = "etsy-shop-mcp-shop"

  lifecycle {
    prevent_destroy = true
  }
}
