variable "account_id" {
  description = "Cloudflare account id. Set as TF_VAR_account_id by scripts/deploy.ts from Doppler's CLOUDFLARE_ACCOUNT_ID."
  type        = string
  nullable    = false
}
