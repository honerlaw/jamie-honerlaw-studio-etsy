#!/usr/bin/env bash
# Revokes every MCP client connection at once: deletes all of the OAuth
# provider's grant and token records from the deployed OAUTH_KV namespace. Every
# connected client gets a 401 on its next call and has to connect again (which
# needs her Etsy sign-in and passes the allowlist again).
#
# Use it when a phone or laptop with a connected client is lost, or anything
# looks wrong. Requires `npx wrangler login` (or CLOUDFLARE_API_TOKEN) and jq.
# The Etsy tokens themselves stay in the vault; to cut Etsy off too, revoke this
# app under Etsy → Account settings → Apps, or rotate TOKEN_ENC_KEYS.
set -euo pipefail

cd "$(dirname "$0")/.."
keys_file="$(mktemp)"
trap 'rm -f "$keys_file"' EXIT

for prefix in "grant:" "token:"; do
  npx wrangler kv key list --binding OAUTH_KV --remote --prefix "$prefix" | jq '[.[].name]' > "$keys_file"
  count="$(jq length "$keys_file")"
  if [ "$count" -gt 0 ]; then
    npx wrangler kv bulk delete "$keys_file" --binding OAUTH_KV --remote --force > /dev/null
  fi
  echo "Deleted $count '$prefix' records."
done
