#!/usr/bin/env bash
# Applies .github/rulesets/main.json to this repository (idempotent: creates the
# ruleset, or updates it in place by name). Requires `gh` authenticated as a
# repository admin.
#
#   scripts/apply-ruleset.sh            create or update, enforcement from the JSON
#   scripts/apply-ruleset.sh --disable  break-glass: set enforcement to "disabled"
#   scripts/apply-ruleset.sh --enable   restore enforcement to "active"
#
# --disable is for a broken CI provider only, never for a failing check.
set -euo pipefail

cd "$(dirname "$0")/.."
RULESET_FILE=".github/rulesets/main.json"
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
NAME="$(jq -r .name "$RULESET_FILE")"

case "${1:-}" in
  "") payload="$(cat "$RULESET_FILE")" ;;
  --disable) payload="$(jq '.enforcement = "disabled"' "$RULESET_FILE")" ;;
  --enable) payload="$(jq '.enforcement = "active"' "$RULESET_FILE")" ;;
  *) echo "usage: $0 [--disable|--enable]" >&2; exit 2 ;;
esac

existing_id="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$NAME\") | .id")"

if [ -n "$existing_id" ]; then
  echo "$payload" | gh api --method PUT "repos/$REPO/rulesets/$existing_id" --input - > /dev/null
  echo "Updated ruleset '$NAME' (id $existing_id) on $REPO."
else
  echo "$payload" | gh api --method POST "repos/$REPO/rulesets" --input - > /dev/null
  echo "Created ruleset '$NAME' on $REPO."
fi
