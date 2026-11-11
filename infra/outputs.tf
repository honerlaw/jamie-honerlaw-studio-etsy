# Keyed by the wrangler.jsonc binding name; scripts/deploy.ts fills each
# kv_namespaces[].id from this map when it writes wrangler.deploy.json.
output "kv_namespace_ids" {
  description = "KV namespace id for each Worker binding."
  value = {
    OAUTH_KV = cloudflare_workers_kv_namespace.oauth.id
    SHOP_KV  = cloudflare_workers_kv_namespace.shop.id
  }
}
